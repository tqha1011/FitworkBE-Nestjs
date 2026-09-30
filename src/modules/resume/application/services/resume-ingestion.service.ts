import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { CommonResumeIngestionStatus } from 'src/shared/domain/enum';
import { IFileStorage } from 'src/shared/infrastructure/storage/file-storage.interface';
import { ResumeIngestionJobDto } from '../dtos/resume-ingestion-job.dto';
import { MAX_RESUME_FILE_SIZE } from '../../domain/entities/resume.entity';
import { IResumeContentRepository } from '../../domain/repositories/resume-content.repo.interface';
import { IResumeIngestionNotifier } from '../interfaces/resume-ingestion-notifier.interface';
import { IResumeIngestionService } from '../interfaces/resume-ingestion.service.interface';
import { IResumeTextExtractor } from '../interfaces/resume-text-extractor.interface';
import { SpanStatusCode, trace } from '@opentelemetry/api';

@Injectable()
export class ResumeIngestionService implements IResumeIngestionService {
  private readonly trace = trace.getTracer('fitwork.resume.ingestion');
  constructor(
    private readonly contentRepository: IResumeContentRepository,
    private readonly fileStorage: IFileStorage,
    private readonly textExtractor: IResumeTextExtractor,
    private readonly notifier: IResumeIngestionNotifier,
  ) {}

  async ingest(
    payload: ResumeIngestionJobDto,
    attemptsMade: number,
    maxAttempts: number,
  ): Promise<void> {
    return this.trace.startActiveSpan('ingest.resume', async (span) => {
      try {
        const contentResult = await this.contentRepository.getByPublicId(
          payload.resumeContentPublicId,
        );
        if (contentResult.isErr()) {
          span.setAttribute('resume.ingest.get.content', 'failed');
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw contentResult.error;
        }
        const content = contentResult.value;
        if (!content || content.resumePublicId !== payload.resumePublicId) {
          span.setAttribute('resume.ingest.content.invalid', 'true');
          span.setStatus({ code: SpanStatusCode.OK });
          throw new Error('Resume ingestion content was not found');
        }
        if (content.status === CommonResumeIngestionStatus.COMPLETED) {
          span.setAttribute('resume.ingestion.content', 'already completed');
          span.setStatus({ code: SpanStatusCode.OK });
          return;
        }

        const processingResult = await this.contentRepository.markProcessing(
          content.publicId,
        );
        if (processingResult.isErr() || !processingResult.value) {
          span.setAttribute('resume.ingest.mark.processing', 'failed');
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw processingResult.isErr()
            ? processingResult.error
            : new Error('Failed to mark resume ingestion as processing');
        }
        await this.notifier.notify(this.toEvent(processingResult.value));

        const objectResult = await this.fileStorage.getObject(
          content.storagePath,
        );
        if (objectResult.isErr()) {
          span.setAttribute('resume.ingest.get.object', 'failed');
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw objectResult.error;
        }
        const buffer = objectResult.value;
        if (
          buffer.length !== content.fileSize ||
          buffer.length <= 0 ||
          buffer.length > MAX_RESUME_FILE_SIZE
        ) {
          span.setAttribute('resume.ingest.get.object.buffer', 'failed');
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw new Error(
            `Resume file size mismatch: expected ${content.fileSize}, received ${buffer.length}`,
          );
        }

        const extractedResult = await this.textExtractor.extract(
          content.fileType,
          buffer,
        );
        if (extractedResult.isErr()) {
          span.setAttribute('resume.ingest.extract.text', 'failed');
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw extractedResult.error;
        }
        const extractedText = this.normalizeText(extractedResult.value);
        if (!extractedText) {
          span.setAttribute('resume.ingest.normalize.extracted.text', 'failed');
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw new Error('Resume text is empty after extraction');
        }

        const completedResult = await this.contentRepository.markCompleted({
          publicId: content.publicId,
          extractedText,
          contentHash: createHash('sha256').update(buffer).digest('hex'),
        });
        if (completedResult.isErr() || !completedResult.value) {
          span.setAttribute('resume.ingest.mark.completed', 'failed');
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw completedResult.isErr()
            ? completedResult.error
            : new Error('Failed to complete resume ingestion');
        }
        await this.notifier.notify(this.toEvent(completedResult.value));
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.setAttribute('resume.ingest.error', 'internal-server-error');
        if (attemptsMade + 1 >= maxAttempts) {
          await this.failFinally(payload.resumeContentPublicId, error);
        }
        throw error;
      } finally {
        span.end();
      }
    });
  }

  private normalizeText(text: string): string {
    return text.replace(/\r\n?/g, '\n').replace(/\0/g, '').trim();
  }

  private async failFinally(publicId: string, error: unknown): Promise<void> {
    const message = (
      error instanceof Error ? error.message : String(error)
    ).slice(0, 4000);
    const failedResult = await this.contentRepository.markFailed(
      publicId,
      message,
    );
    if (failedResult.isErr()) {
      throw failedResult.error;
    }
    if (failedResult.value) {
      await this.notifier.notify(this.toEvent(failedResult.value));
    }
  }

  private toEvent(content: {
    resumePublicId: string;
    publicId: string;
    status: CommonResumeIngestionStatus;
    errorMessage: string | null;
    updatedAt: Date;
  }) {
    return {
      resumePublicId: content.resumePublicId,
      ingestionPublicId: content.publicId,
      status: content.status,
      ...(content.errorMessage
        ? { errorMessage: content.errorMessage }
        : undefined),
      updatedAt: content.updatedAt.toISOString(),
    };
  }
}
