import { Injectable } from '@nestjs/common';
import { AppError } from 'src/shared/common/errorCode';
import {
  consumeDemoAi,
  lockDemo,
} from 'src/modules/demo/infrastructure/demo-transaction';
import { createHash } from 'crypto';
import { EvaluationStatus } from 'generated/prisma/enums';
import { Prisma } from 'generated/prisma/client';
import { err, ok, Result } from 'neverthrow';
import { JobSnapshot } from 'src/modules/job/domain/value-objects/job-snapshot';
import { hashCanonicalJson } from 'src/shared/common/canonical-json';
import { CommonEvaluationStatus } from 'src/shared/domain/enum';
import { PrismaService } from 'src/shared/infrastructure/database/prisma.service';
import { createResumeEvaluationSnapshot } from '../application/services/resume-redact-evaluation';
import {
  ApplicantEvaluationProcessingData,
  ApplicantEvaluationRealtimeState,
  CompleteApplicantEvaluationInput,
  IApplicantEvaluationRepository,
  PreparedApplicantEvaluation,
  PrepareApplicantEvaluationInput,
  ApplicantEvaluationDetail,
  ApplicantEvaluationForJobOwner,
} from '../domain/repositories/applicant-evaluation.repo.interface';
import {
  mapEvaluationBreakdown,
  mapEvaluationEvidence,
} from './applicant-evaluation.mapper';

@Injectable()
export class ApplicantEvaluationRepository implements IApplicantEvaluationRepository {
  constructor(private readonly prismaService: PrismaService) {}
  async getApplicantEvaluationForJobOwner(
    evaluationPublicId: string,
    jobPublicId: string,
  ): Promise<Result<ApplicantEvaluationForJobOwner | null, Error>> {
    try {
      const evaluation =
        await this.prismaService.applicantEvaluation.findUnique({
          where: {
            publicId: evaluationPublicId,
            jobApplicant: {
              job: {
                publicId: jobPublicId,
              },
            },
          },
          select: {
            publicId: true,
            source: true,
            overallScore: true,
            scoreBreakdown: true,
            evidence: true,
            redactedResumeText: true,
            redactedResumeHash: true,
            redactionVersion: true,
            jobContentHash: true,
            resumeContentHash: true,
            parserVersion: true,
            model: true,
            promptVersion: true,
          },
        });
      if (!evaluation) return ok(null);
      const resumeRedaction = {
        redactedResumeText: evaluation.redactedResumeText,
        redactedResumeVersion: evaluation.redactionVersion,
      };
      return ok({
        publicId: evaluation.publicId,
        source: evaluation.source === 'SAMPLE' ? 'SAMPLE' : 'LIVE',
        overallScore: evaluation.overallScore,
        scoreBreakdown: mapEvaluationBreakdown(evaluation.scoreBreakdown),
        evidence: mapEvaluationEvidence(evaluation.evidence),
        resumeRedaction,
        decisionSupportOnly: true,
        metadata: {
          jobContentHash: evaluation.jobContentHash,
          resumeContentHash: evaluation.resumeContentHash,
          redactedResumeHash: evaluation.redactedResumeHash,
          parserVersion: evaluation.parserVersion,
          redactionVersion: evaluation.redactionVersion,
          model: evaluation.model,
          promptVersion: evaluation.promptVersion,
        },
      });
    } catch (error) {
      return err(
        new Error('Failed to get applicant evaluation for job owner', {
          cause: error,
        }),
      );
    }
  }
  async getApplicantEvaluationDetail(
    applicantPublicId: string,
    jobPublicId: string,
    evaluationPublicId?: string,
  ): Promise<Result<ApplicantEvaluationDetail | null, Error>> {
    try {
      const job = await this.prismaService.job.findUnique({
        where: { publicId: jobPublicId },
        select: {
          jobApplicants: {
            where: { applicant: { publicId: applicantPublicId } },
            take: 1,
            select: {
              evaluations: {
                ...(evaluationPublicId
                  ? { where: { publicId: evaluationPublicId } }
                  : {}),
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                take: 1,
                select: {
                  publicId: true,
                  source: true,
                  overallScore: true,
                  scoreBreakdown: true,
                  evidence: true,
                },
              },
            },
          },
        },
      });
      const evaluation = job?.jobApplicants[0]?.evaluations[0];
      if (!evaluation) return ok(null);
      return ok({
        evaluationPublicId: evaluation.publicId,
        source: evaluation.source === 'SAMPLE' ? 'SAMPLE' : 'LIVE',
        overallScore: evaluation.overallScore,
        scoreBreakdown: mapEvaluationBreakdown(evaluation.scoreBreakdown),
        evidence: mapEvaluationEvidence(evaluation.evidence),
      });
    } catch (error) {
      return err(
        new Error('Failed to get applicant evaluation detail', {
          cause: error,
        }),
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
        new Error('Failed to get applicant evaluation realtime state', {
          cause: error,
        }),
      );
    }
  }

  async prepare(
    input: PrepareApplicantEvaluationInput,
  ): Promise<Result<PreparedApplicantEvaluation | null, Error>> {
    try {
      const prepared = await this.prismaService.$transaction(async (tx) => {
        if (input.demoSessionId) await lockDemo(tx);
        const application = await tx.jobApplicant.findFirst({
          where: {
            jobId: input.jobId,
            resumeId: input.resumeId,
            applicant: {
              publicId: input.applicantPublicId,
              ...(input.demoSessionId
                ? { demoSessionId: input.demoSessionId }
                : {}),
            },
            ...(input.demoSessionId
              ? { job: { user: { demoSessionId: input.demoSessionId } } }
              : {}),
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
        let charged = false;
        if (input.demoSessionId && input.demoLimits) {
          const existing = await tx.applicantEvaluation.findUnique({
            where: {
              jobApplicantId_resumeContentHash_jobContentHash_parserVersion_model_promptVersion:
                uniqueInput,
            },
            select: { status: true },
          });
          if (!existing || existing.status === EvaluationStatus.FAILED) {
            await consumeDemoAi(tx, input.demoSessionId, input.demoLimits);
            charged = true;
          }
        }
        const evaluation = await tx.applicantEvaluation.upsert({
          where: {
            jobApplicantId_resumeContentHash_jobContentHash_parserVersion_model_promptVersion:
              uniqueInput,
          },
          update: {},
          create: {
            ...uniqueInput,
            jobSnapshot: input.jobSnapshot,
            resumeContentId: input.resumeContentId,
            redactedResumeText: input.redactedResumeText,
            redactedResumeHash: input.redactedResumeHash,
            redactionVersion: input.redactionVersion,
          },
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
            ...(input.demoSessionId ? { charged } : {}),
            status: CommonEvaluationStatus.PENDING,
            resetFromFailed: true,
          };
        }

        return {
          publicId: evaluation.publicId,
          ...(input.demoSessionId ? { charged } : {}),
          status: this.toCommonStatus(evaluation.status),
          resetFromFailed: false,
        };
      });

      return ok(prepared);
    } catch (error) {
      if (error instanceof AppError) return err(error);
      return err(
        new Error('Failed to prepare applicant evaluation', { cause: error }),
      );
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
              jobApplicant: {
                select: { applicant: { select: { demoSession: true } } },
              },
              jobContentHash: true,
              parserVersion: true,
              model: true,
              promptVersion: true,
              jobSnapshot: true,
              resumeContent: {
                select: {
                  extractedText: true,
                  contentHash: true,
                  parserVersion: true,
                },
              },
              redactedResumeHash: true,
              redactedResumeText: true,
              redactionVersion: true,
            },
          });
          if (!evaluation) {
            return null;
          }
          const demoSession = evaluation.jobApplicant?.applicant?.demoSession;
          if (
            demoSession &&
            (demoSession.revokedAt || demoSession.expiresAt <= new Date())
          )
            return null;
          if (
            evaluation.status !== EvaluationStatus.PENDING &&
            evaluation.status !== EvaluationStatus.PROCESSING
          ) {
            return null;
          }
          if (
            evaluation.jobSnapshot === null &&
            evaluation.resumeContent === null
          ) {
            const result = await tx.applicantEvaluation.findUnique({
              where: {
                publicId: evaluationPublicId,
              },
              select: {
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
            if (
              !result?.jobApplicant.resumeContent ||
              !result.jobApplicant.jobSnapshot
            ) {
              throw new Error('Evaluation input is unavailable');
            }
            evaluation.jobSnapshot = result.jobApplicant.jobSnapshot;
            evaluation.resumeContent = result.jobApplicant.resumeContent;
          }

          const jobSnapshot = this.toJobSnapshot(evaluation.jobSnapshot);
          const resumeContent = evaluation.resumeContent;
          if (!resumeContent?.contentHash) {
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

          // check if missing one of the redacted resume snapshot fields
          const hasRedactedSnapshot =
            evaluation.redactedResumeText != null ||
            evaluation.redactedResumeHash != null ||
            evaluation.redactionVersion != null;
          if (
            hasRedactedSnapshot &&
            (!evaluation.redactedResumeText ||
              !evaluation.redactedResumeHash ||
              !evaluation.redactionVersion)
          ) {
            throw new Error(
              'Evaluation redacted resume snapshot is incomplete',
            );
          }

          // if dont have snapshot, create it
          const snapshot = hasRedactedSnapshot
            ? {
                text: evaluation.redactedResumeText!,
                hash: evaluation.redactedResumeHash!,
                redactionVersion: evaluation.redactionVersion!,
              }
            : createResumeEvaluationSnapshot(resumeContent.extractedText ?? '');
          if (
            createHash('sha256').update(snapshot.text, 'utf8').digest('hex') !==
            snapshot.hash
          ) {
            throw new Error('Evaluation redacted resume hash does not match');
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
              ...(!hasRedactedSnapshot && {
                redactedResumeText: snapshot.text,
                redactedResumeHash: snapshot.hash,
                redactionVersion: snapshot.redactionVersion,
              }),
            },
          });
          if (claimed.count === 0) {
            return null;
          }

          return {
            ...(demoSession ? { demo: true } : {}),
            publicId: evaluation.publicId,
            jobSnapshot,
            resumeRedactedText: snapshot.text,
            resumeRedactedHash: snapshot.hash,
            resumeRedactionVersion: snapshot.redactionVersion,
            model: evaluation.model,
            promptVersion: evaluation.promptVersion,
          };
        },
      );

      return ok(processingData);
    } catch (error) {
      return err(
        new Error('Failed to claim applicant evaluation', { cause: error }),
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
        new Error('Failed to complete applicant evaluation', { cause: error }),
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
        new Error('Failed to release applicant evaluation for retry', {
          cause: error,
        }),
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
        new Error('Failed to fail applicant evaluation', { cause: error }),
      );
    }
  }

  private toJobSnapshot(value: Prisma.JsonValue | null): JobSnapshot {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Evaluation job snapshot is missing or invalid');
    }

    return value as JobSnapshot;
  }

  private toCommonStatus(status: EvaluationStatus): CommonEvaluationStatus {
    return status as CommonEvaluationStatus;
  }
}
