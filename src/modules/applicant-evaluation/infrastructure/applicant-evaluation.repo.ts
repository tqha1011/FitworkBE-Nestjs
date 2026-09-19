import { Injectable } from '@nestjs/common';
import { EvaluationStatus } from 'generated/prisma/enums';
import { Prisma } from 'generated/prisma/client';
import { err, ok, Result } from 'neverthrow';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import { CommonEvaluationStatus } from 'src/shared/domain/enum';
import {
  IApplicantEvaluationRepository,
  PreparedApplicantEvaluation,
  PrepareApplicantEvaluationInput,
} from '../domain/repositories/applicant-evaluation.repo.interface';

@Injectable()
export class ApplicantEvaluationRepository implements IApplicantEvaluationRepository {
  constructor(private readonly prismaService: PrismaService) {}

  async prepare(
    input: PrepareApplicantEvaluationInput,
  ): Promise<Result<PreparedApplicantEvaluation | null, Error>> {
    try {
      const prepared = await this.prismaService.$transaction(async (tx) => {
        const application = await tx.jobApplicant.findFirst({
          where: {
            jobId: input.jobId,
            resumeId: input.resumeId,
            applicant: { publicId: input.applicantPublicId },
          },
          select: { id: true },
        });
        if (!application) {
          return null;
        }

        await tx.jobApplicant.update({
          where: { id: application.id },
          data: {
            resumeContentId: input.resumeContentId,
            jobSnapshot: input.jobSnapshot,
            jobContentHash: input.jobContentHash,
            updatedAt: new Date(),
          },
        });

        const uniqueInput = {
          jobApplicantId: application.id,
          resumeContentHash: input.resumeContentHash,
          jobContentHash: input.jobContentHash,
          parserVersion: input.parserVersion,
          model: input.model,
          promptVersion: input.promptVersion,
        };
        const evaluation = await tx.applicantEvaluation.upsert({
          where: {
            jobApplicantId_resumeContentHash_jobContentHash_parserVersion_model_promptVersion:
              uniqueInput,
          },
          update: {},
          create: uniqueInput,
          select: { publicId: true, status: true },
        });

        if (evaluation.status === EvaluationStatus.FAILED) {
          await tx.applicantEvaluation.update({
            where: { publicId: evaluation.publicId },
            data: {
              status: EvaluationStatus.PENDING,
              errorMessage: null,
              overallScore: null,
              scoreBreakdown: Prisma.DbNull,
              evidence: Prisma.DbNull,
              evaluatedAt: null,
            },
          });
          return {
            publicId: evaluation.publicId,
            status: CommonEvaluationStatus.PENDING,
            resetFromFailed: true,
          };
        }

        return {
          publicId: evaluation.publicId,
          status: this.toCommonStatus(evaluation.status),
          resetFromFailed: false,
        };
      });

      return ok(prepared);
    } catch (error) {
      return err(new Error(`Failed to prepare applicant evaluation: ${error}`));
    }
  }

  private toCommonStatus(status: EvaluationStatus): CommonEvaluationStatus {
    return status as CommonEvaluationStatus;
  }
}
