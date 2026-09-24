import { err, ok } from 'neverthrow';
import { CommonEvaluationStatus } from 'src/shared/domain/enum';
import { IApplicantEvaluationRepository } from '../../domain/repositories/applicant-evaluation.repo.interface';
import { ApplicantEvaluationProcessingService } from './applicant-evaluation.processing.service';

describe('ApplicantEvaluationProcessingService', () => {
  const jobSnapshot = {
    schemaVersion: 1 as const,
    publicId: 'job-id',
    title: 'Backend Engineer',
    description: 'Build services',
    requirements: 'TypeScript',
    location: 'Remote',
    skills: [{ id: 1, name: 'TypeScript' }],
    category: { id: 2, name: 'Engineering' },
    arrangement: { id: 3, name: 'Remote' },
  };
  const output = {
    schemaVersion: 1 as const,
    overallScore: 88,
    scoreBreakdown: {
      schemaVersion: 1 as const,
      skills: 90,
      experience: 85,
      education: 75,
      overallFit: 88,
    },
    evidence: {
      schemaVersion: 1 as const,
      strengths: ['Strong TypeScript experience'],
      gaps: ['No PostgreSQL evidence'],
      explanation: 'The candidate matches most requirements.',
    },
  };

  let repository: {
    claimForProcessing: jest.Mock;
    markCompleted: jest.Mock;
    markPending: jest.Mock;
    markFailed: jest.Mock;
  };
  let llm: { evaluate: jest.Mock };
  let notifier: { notify: jest.Mock };
  let service: ApplicantEvaluationProcessingService;

  beforeEach(() => {
    repository = {
      claimForProcessing: jest.fn().mockResolvedValue(
        ok({
          publicId: 'evaluation-id',
          jobSnapshot,
          resumeRedactedText:
            'Experienced TypeScript engineer [REDACTED CONTACT]',
          resumeRedactedHash: 'redacted-hash',
          resumeRedactionVersion: 'resume-redaction-v1',
          model: 'gemini-model',
          promptVersion: 'v1',
        }),
      ),
      markCompleted: jest.fn().mockResolvedValue(ok(true)),
      markPending: jest.fn().mockResolvedValue(ok(true)),
      markFailed: jest.fn().mockResolvedValue(ok(true)),
    };
    llm = { evaluate: jest.fn().mockResolvedValue(ok(output)) };
    notifier = { notify: jest.fn().mockResolvedValue(undefined) };
    service = new ApplicantEvaluationProcessingService(
      repository as unknown as IApplicantEvaluationRepository,
      llm,
      notifier,
    );
  });

  it('completes the evaluation and publishes the score', async () => {
    const result = await service.process('evaluation-id', 0, 3);

    expect(result.isOk()).toBe(true);
    expect(repository.markCompleted).toHaveBeenCalledWith({
      evaluationPublicId: 'evaluation-id',
      overallScore: output.overallScore,
      scoreBreakdown: output.scoreBreakdown,
      evidence: output.evidence,
    });
    expect(llm.evaluate).toHaveBeenCalledWith({
      jobSnapshot,
      resumeText: 'Experienced TypeScript engineer [REDACTED CONTACT]',
      model: 'gemini-model',
    });
    expect(notifier.notify).toHaveBeenCalledWith({
      evaluationPublicId: 'evaluation-id',
      status: CommonEvaluationStatus.COMPLETED,
      overallScore: output.overallScore,
      updatedAt: expect.any(String) as string,
    });
  });

  it('treats a terminal or concurrently handled evaluation idempotently', async () => {
    repository.claimForProcessing.mockResolvedValue(ok(null));

    const result = await service.process('evaluation-id', 0, 3);

    expect(result.isOk()).toBe(true);
    expect(llm.evaluate).not.toHaveBeenCalled();
    expect(repository.markCompleted).not.toHaveBeenCalled();
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it('returns a failed attempt to pending before BullMQ retries it', async () => {
    llm.evaluate.mockResolvedValue(err(new Error('Gemini unavailable')));

    const result = await service.process('evaluation-id', 0, 3);

    expect(result._unsafeUnwrapErr().message).toBe('Gemini unavailable');
    expect(repository.markPending).toHaveBeenCalledWith(
      'evaluation-id',
      'Gemini unavailable',
    );
    expect(repository.markFailed).not.toHaveBeenCalled();
    expect(notifier.notify).toHaveBeenCalledWith({
      evaluationPublicId: 'evaluation-id',
      status: CommonEvaluationStatus.PENDING,
      errorMessage: 'Gemini unavailable',
      updatedAt: expect.any(String) as string,
    });
  });

  it('marks the evaluation failed on the final BullMQ attempt', async () => {
    llm.evaluate.mockResolvedValue(err(new Error('Invalid response')));

    const result = await service.process('evaluation-id', 2, 3);

    expect(result._unsafeUnwrapErr().message).toBe('Invalid response');
    expect(repository.markFailed).toHaveBeenCalledWith(
      'evaluation-id',
      'Invalid response',
    );
    expect(repository.markPending).not.toHaveBeenCalled();
    expect(notifier.notify).toHaveBeenCalledWith({
      evaluationPublicId: 'evaluation-id',
      status: CommonEvaluationStatus.FAILED,
      errorMessage: 'Invalid response',
      updatedAt: expect.any(String) as string,
    });
  });

  it('persists a claim error as a retryable failure', async () => {
    repository.claimForProcessing.mockResolvedValue(
      err(new Error('database unavailable')),
    );

    const result = await service.process('evaluation-id', 1, 3);

    expect(result._unsafeUnwrapErr().message).toBe('database unavailable');
    expect(repository.markPending).toHaveBeenCalledWith(
      'evaluation-id',
      'database unavailable',
    );
    expect(llm.evaluate).not.toHaveBeenCalled();
  });

  it('includes a state transition failure in the returned error', async () => {
    llm.evaluate.mockResolvedValue(err(new Error('Gemini unavailable')));
    repository.markPending.mockResolvedValue(
      err(new Error('database unavailable')),
    );

    const result = await service.process('evaluation-id', 0, 3);

    expect(result._unsafeUnwrapErr().message).toContain(
      'failed to persist evaluation failure state: database unavailable',
    );
  });

  it('stops retrying when another worker already moved the state', async () => {
    llm.evaluate.mockResolvedValue(err(new Error('Gemini unavailable')));
    repository.markPending.mockResolvedValue(ok(false));

    const result = await service.process('evaluation-id', 0, 3);

    expect(result.isOk()).toBe(true);
  });
});
