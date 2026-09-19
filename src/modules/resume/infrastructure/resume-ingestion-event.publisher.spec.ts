import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CommonResumeIngestionStatus } from 'src/shared/domain/enum';
import { RESUME_INGESTION_UPDATED_EVENT } from '../application/interfaces/resume-ingestion-notifier.interface';
import { ResumeIngestionEventPublisher } from './resume-ingestion-event.publisher';

describe('ResumeIngestionEventPublisher', () => {
  const event = {
    resumePublicId: '7c143f51-29dd-45d1-9d36-a5d780f5c843',
    ingestionPublicId: 'aee177b4-9d37-47e5-a037-b7bbb93b7f89',
    status: CommonResumeIngestionStatus.COMPLETED,
    updatedAt: '2026-09-19T00:00:00.000Z',
  };

  it('publishes the ingestion update through the application event bus', async () => {
    const emit = jest.fn();
    const publisher = new ResumeIngestionEventPublisher({
      emit,
    } as unknown as EventEmitter2);

    await publisher.notify(event);

    expect(emit).toHaveBeenCalledWith(RESUME_INGESTION_UPDATED_EVENT, event);
  });

  it('does not fail ingestion when notification delivery throws', async () => {
    const logError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const publisher = new ResumeIngestionEventPublisher({
      emit: jest.fn(() => {
        throw new Error('listener failed');
      }),
    } as unknown as EventEmitter2);

    await expect(publisher.notify(event)).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalled();
    logError.mockRestore();
  });
});
