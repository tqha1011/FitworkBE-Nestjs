import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  IResumeIngestionNotifier,
  RESUME_INGESTION_UPDATED_EVENT,
  ResumeIngestionUpdatedEvent,
} from '../application/interfaces/resume-ingestion-notifier.interface';

@Injectable()
export class ResumeIngestionEventPublisher implements IResumeIngestionNotifier {
  private readonly logger = new Logger(ResumeIngestionEventPublisher.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  notify(event: ResumeIngestionUpdatedEvent): Promise<void> {
    try {
      this.eventEmitter.emit(RESUME_INGESTION_UPDATED_EVENT, event);
    } catch (error) {
      this.logger.error(
        'Failed to publish resume ingestion update',
        error instanceof Error ? error.stack : String(error),
      );
    }

    return Promise.resolve();
  }
}
