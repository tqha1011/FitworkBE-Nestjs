import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  APPLICANT_EVALUATION_UPDATED_EVENT,
  ApplicantEvaluationUpdatedEvent,
  IApplicantEvaluationNotifier,
} from '../application/interfaces/applicant-evaluation-notifier.interface';

@Injectable()
export class ApplicantEvaluationEventPublisher implements IApplicantEvaluationNotifier {
  private readonly logger = new Logger(ApplicantEvaluationEventPublisher.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  notify(event: ApplicantEvaluationUpdatedEvent): Promise<void> {
    try {
      this.eventEmitter.emit(APPLICANT_EVALUATION_UPDATED_EVENT, event);
    } catch (error) {
      this.logger.error(
        'Failed to publish applicant evaluation update',
        error instanceof Error ? error.stack : String(error),
      );
    }

    return Promise.resolve();
  }
}
