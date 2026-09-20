import { Injectable } from '@nestjs/common';
import { EvaluationStatus } from 'generated/prisma/enums';
import { Prisma } from 'generated/prisma/client';
import { err, ok, Result } from 'neverthrow';
import { JobSnapshotV1 } from 'src/modules/job/domain/value-objects/job-snapshot';
import { hashCanonicalJson } from 'src/shared/common/canonical-json';
import { CommonEvaluationStatus } from 'src/shared/domain/enum';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import {
  ApplicantEvaluationProcessingData,
  ApplicantEvaluationRealtimeState,
  CompleteApplicantEvaluationInput,
  IApplicantEvaluationRepository,
  PreparedApplicantEvaluation,
  PrepareApplicantEvaluationInput,
  ApplicantEvaluationDetail,
} from '../domain/repositories/applicant-evaluation.repo.interface';
import {
  mapEvaluationBreakdown,
  mapEvaluationEvidence,
} from './applicant-evaluation.mapper';

@Injectable()
export class ApplicantEvaluationRepository implements IApplicantEvaluationRepository {
  constructor(private readonly prismaService: PrismaService) {}
  async getApplicantEvaluationDetail(
    applicantPublicId: string,
    evaluationPublicId: string,
  ): Promise<Result<ApplicantEvaluationDetail | null, Error>> {
    try {
      const evaluation =
        await this.prismaService.applicantEvaluation.findUnique({
          where: {
            publicId: evaluationPublicId,
            jobApplicant: { applicant: { publicId: applicantPublicId } },
          },
          select: {
            publicId: true,
            overallScore: true,
            scoreBreakdown: true,
            evidence: true,
          },
        });
      if (!evaluation) return ok(null);
      return ok({
        evaluationPublicId: evaluation.publicId,
        overallScore: evaluation.overallScore,
        scoreBreakdown: mapEvaluationBreakdown(evaluation.scoreBreakdown),
        evidence: mapEvaluationEvidence(evaluation.evidence),
      });
    } catch (error) {
      return err(
        new Error(`Failed to get applicant evaluation detail: ${error}`),
      );
    }
  }

  async getRealtimeStateForApplicant(
    evaluationPublicId: string,
    applicantPublicId: string,
  ): Promise<Result<ApplicantEvaluationRealtimeState | null, Error>> {
    try {
      const evaluation =
        await this.prismaService.applicantEvaluation.findUnique({
          where: {
            publicId: evaluationPublicId,
            jobApplicant: { applicant: { publicId: applicantPublicId } },
          },
          select: {
            publicId: true,
            status: true,
            overallScore: true,
            errorMessage: true,
            updatedAt: true,
          },
        });
      if (!evaluation) {
        return ok(null);
      }
      return ok({
        evaluationPublicId: evaluation.publicId,
        status: this.toCommonStatus(evaluation.status),
        overallScore: evaluation.overallScore,
        errorMessage: evaluation.errorMessage,
        updatedAt: evaluation.updatedAt,
      });
    } catch (error) {
      return err(
        new Error(
          `Failed to get applicant evaluation realtime state: ${String(error)}`,
        ),
      );
    }
  }

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

  async claimForProcessing(
    evaluationPublicId: string,
  ): Promise<Result<ApplicantEvaluationProcessingData | null, Error>> {
    try {
      const processingData = await this.prismaService.$transaction(
        async (tx) => {
          const evaluation = await tx.applicantEvaluation.findUnique({
            where: { publicId: evaluationPublicId },
            select: {
              publicId: true,
              status: true,
              resumeContentHash: true,
              jobContentHash: true,
              parserVersion: true,
              model: true,
              promptVersion: true,
              jobApplicant: {
                select: {
                  jobSnapshot: true,
                  resumeContent: {
                    select: {
                      extractedText: true,
                      contentHash: true,
                      parserVersion: true,
                    },
                  },
                },
              },
            },
          });
          if (!evaluation) {
            return null;
          }
          if (
            evaluation.status !== EvaluationStatus.PENDING &&
            evaluation.status !== EvaluationStatus.PROCESSING
          ) {
            return null;
          }

          const jobSnapshot = this.toJobSnapshot(
            evaluation.jobApplicant.jobSnapshot,
          );
          const resumeContent = evaluation.jobApplicant.resumeContent;
          if (!resumeContent?.extractedText || !resumeContent.contentHash) {
            throw new Error('Evaluation resume content is incomplete');
          }
          if (hashCanonicalJson(jobSnapshot) !== evaluation.jobContentHash) {
            throw new Error('Evaluation job snapshot hash does not match');
          }
          if (resumeContent.contentHash !== evaluation.resumeContentHash) {
            throw new Error('Evaluation resume content hash does not match');
          }
          if (resumeContent.parserVersion !== evaluation.parserVersion) {
            throw new Error('Evaluation parser version does not match');
          }

          const claimed = await tx.applicantEvaluation.updateMany({
            where: {
              publicId: evaluationPublicId,
              status: {
                in: [EvaluationStatus.PENDING, EvaluationStatus.PROCESSING],
              },
            },
            data: {
              status: EvaluationStatus.PROCESSING,
              errorMessage: null,
            },
          });
          if (claimed.count === 0) {
            return null;
          }

          return {
            publicId: evaluation.publicId,
            jobSnapshot,
            resumeText: resumeContent.extractedText,
            model: evaluation.model,
            promptVersion: evaluation.promptVersion,
          };
        },
      );

      return ok(processingData);
    } catch (error) {
      return err(
        new Error(`Failed to claim applicant evaluation: ${String(error)}`),
      );
    }
  }

  async markCompleted(
    input: CompleteApplicantEvaluationInput,
  ): Promise<Result<boolean, Error>> {
    try {
      const updated = await this.prismaService.applicantEvaluation.updateMany({
        where: {
          publicId: input.evaluationPublicId,
          status: EvaluationStatus.PROCESSING,
        },
        data: {
          status: EvaluationStatus.COMPLETED,
          overallScore: input.overallScore,
          scoreBreakdown: input.scoreBreakdown,
          evidence: input.evidence,
          errorMessage: null,
          evaluatedAt: new Date(),
        },
      });
      return ok(updated.count > 0);
    } catch (error) {
      return err(
        new Error(`Failed to complete applicant evaluation: ${String(error)}`),
      );
    }
  }

  async markPending(
    evaluationPublicId: string,
    errorMessage: string,
  ): Promise<Result<boolean, Error>> {
    try {
      const updated = await this.prismaService.applicantEvaluation.updateMany({
        where: {
          publicId: evaluationPublicId,
          status: {
            in: [EvaluationStatus.PENDING, EvaluationStatus.PROCESSING],
          },
        },
        data: {
          status: EvaluationStatus.PENDING,
          errorMessage,
          overallScore: null,
          scoreBreakdown: Prisma.DbNull,
          evidence: Prisma.DbNull,
          evaluatedAt: null,
        },
      });
      return ok(updated.count > 0);
    } catch (error) {
      return err(
        new Error(
          `Failed to release applicant evaluation for retry: ${String(error)}`,
        ),
      );
    }
  }

  async markFailed(
    evaluationPublicId: string,
    errorMessage: string,
  ): Promise<Result<boolean, Error>> {
    try {
      const updated = await this.prismaService.applicantEvaluation.updateMany({
        where: {
          publicId: evaluationPublicId,
          status: {
            in: [EvaluationStatus.PENDING, EvaluationStatus.PROCESSING],
          },
        },
        data: {
          status: EvaluationStatus.FAILED,
          errorMessage,
          overallScore: null,
          scoreBreakdown: Prisma.DbNull,
          evidence: Prisma.DbNull,
          evaluatedAt: null,
        },
      });
      return ok(updated.count > 0);
    } catch (error) {
      return err(
        new Error(`Failed to fail applicant evaluation: ${String(error)}`),
      );
    }
  }

  private toJobSnapshot(value: Prisma.JsonValue | null): JobSnapshotV1 {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Evaluation job snapshot is missing or invalid');
    }

    return value as JobSnapshotV1;
  }

  private toCommonStatus(status: EvaluationStatus): CommonEvaluationStatus {
    return status as CommonEvaluationStatus;
  }
}
