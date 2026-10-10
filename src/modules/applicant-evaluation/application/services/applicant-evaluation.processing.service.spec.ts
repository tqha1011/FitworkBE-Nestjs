import { err, ok } from 'neverthrow';
import { CommonEvaluationStatus } from 'src/shared/domain/enum';
import { IApplicantEvaluationRepository } from '../../domain/repositories/applicant-evaluation.repo.interface';
import { ApplicantEvaluationProcessingService } from './applicant-evaluation.processing.service';
import { buildJobSnapshotV2 } from 'src/modules/job/domain/value-objects/job-snapshot';

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
      promptVersion: 'v1',
    });
    expect(notifier.notify).toHaveBeenCalledWith({
      evaluationPublicId: 'evaluation-id',
      status: CommonEvaluationStatus.COMPLETED,
      overallScore: output.overallScore,
      updatedAt: expect.any(String) as string,
    });
  });

  it('stores validated V2 evidence and computed scores', async () => {
    const v2JobSnapshot = buildJobSnapshotV2(jobSnapshot);
    repository.claimForProcessing.mockResolvedValue(
      ok({
        publicId: 'evaluation-id',
        jobSnapshot: v2JobSnapshot,
        resumeRedactedText: 'TypeScript',
        resumeRedactedHash: 'hash',
        resumeRedactionVersion: 'v1',
        model: 'gemini-model',
        promptVersion: 'v2',
      }),
    );
    const evidence = {
      schemaVersion: 2,
      strengths: ['TypeScript'],
      gaps: [],
      explanation: 'Relevant skill found.',
      criteria: [
        {
          criterionId: 'skill:1',
          criterionText: 'Experience with TypeScript',
          verdict: 'PARTIAL',
          scoreContribution: 42,
          explanation: 'Skill is mentioned.',
          evidence: [
            {
              snippet: 'TypeScript',
              section: 'resume',
              startOffset: 0,
              endOffset: 10,
            },
          ],
        },
      ],
    };
    llm.evaluate.mockResolvedValue(ok({ schemaVersion: 2, evidence }));

    expect((await service.process('evaluation-id', 0, 3)).isOk()).toBe(true);
    expect(repository.markCompleted).toHaveBeenCalledWith({
      evaluationPublicId: 'evaluation-id',
      overallScore: 42,
      scoreBreakdown: {
        schemaVersion: 2,
        criteria: [{ criterionId: 'skill:1', scoreContribution: 42 }],
      },
      evidence,
    });
  });

  it('computes evidence offsets from a unique exact snippet before completing V2', async () => {
    repository.claimForProcessing.mockResolvedValue(
      ok({
        publicId: 'evaluation-id',
        jobSnapshot: buildJobSnapshotV2(jobSnapshot),
        resumeRedactedText: '👩‍💻 Tôi dùng TypeScript.',
        resumeRedactedHash: 'hash',
        resumeRedactionVersion: 'v1',
        model: 'gemini-model',
        promptVersion: 'v2',
      }),
    );
    const evidence = {
      schemaVersion: 2,
      strengths: [],
      gaps: [],
      explanation: 'Skill found.',
      criteria: [
        {
          criterionId: 'skill:1',
          criterionText: 'Experience with TypeScript',
          verdict: 'MATCHED',
          scoreContribution: 80,
          explanation: 'Skill found.',
          evidence: [
            {
              snippet: 'TypeScript',
              section: 'resume',
              startOffset: 2,
              endOffset: 12,
            },
          ],
        },
      ],
    };
    llm.evaluate.mockResolvedValue(ok({ schemaVersion: 2, evidence }));
    const result = await service.process('evaluation-id', 0, 3);
    expect(result.isOk()).toBe(true);
    expect(repository.markCompleted).toHaveBeenCalledWith({
      evaluationPublicId: 'evaluation-id',
      overallScore: 80,
      scoreBreakdown: {
        schemaVersion: 2,
        criteria: [{ criterionId: 'skill:1', scoreContribution: 80 }],
      },
      evidence: {
        ...evidence,
        criteria: [
          {
            ...evidence.criteria[0],
            evidence: [
              {
                snippet: 'TypeScript',
                section: 'resume',
                startOffset: 15,
                endOffset: 25,
              },
            ],
          },
        ],
      },
    });
    expect(evidence.criteria[0].evidence[0].startOffset).toBe(2);
    expect(repository.markPending).not.toHaveBeenCalled();
  });

  it('rejects ambiguous snippets when the model offsets are wrong', async () => {
    repository.claimForProcessing.mockResolvedValue(
      ok({
        publicId: 'evaluation-id',
        jobSnapshot: buildJobSnapshotV2(jobSnapshot),
        resumeRedactedText: 'TypeScript and TypeScript',
        resumeRedactedHash: 'hash',
        resumeRedactionVersion: 'v1',
        model: 'gemini-model',
        promptVersion: 'v2',
      }),
    );
    llm.evaluate.mockResolvedValue(
      ok({
        schemaVersion: 2,
        evidence: {
          schemaVersion: 2,
          strengths: [],
          gaps: [],
          explanation: 'Skill found.',
          criteria: [
            {
              criterionId: 'skill:1',
              criterionText: 'Experience with TypeScript',
              verdict: 'MATCHED',
              scoreContribution: 80,
              explanation: 'Skill found.',
              evidence: [
                {
                  snippet: 'TypeScript',
                  section: 'resume',
                  startOffset: 2,
                  endOffset: 12,
                },
              ],
            },
          ],
        },
      }),
    );
    const result = await service.process('evaluation-id', 0, 3);
    const failure = result._unsafeUnwrapErr();
    expect(failure.message).toBe('Invalid evaluation V2 response');
    expect(failure.cause).toEqual(
      expect.objectContaining({ code: 'V2_EVIDENCE_AMBIGUOUS' }),
    );
    expect(repository.markCompleted).not.toHaveBeenCalled();
    expect(repository.markPending).toHaveBeenCalled();
  });

  it('does not complete an invalid V2 response', async () => {
    llm.evaluate.mockResolvedValue(
      ok({ schemaVersion: 2, evidence: { schemaVersion: 2, criteria: [] } }),
    );

    const result = await service.process('evaluation-id', 0, 3);

    expect(result._unsafeUnwrapErr().message).toBe(
      'LLM returned an invalid evaluation response',
    );
    expect(repository.markPending).toHaveBeenCalledWith(
      'evaluation-id',
      'LLM returned an invalid evaluation response',
    );
    expect(repository.markCompleted).not.toHaveBeenCalled();
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ status: CommonEvaluationStatus.PENDING }),
    );
  });

  it('retries a well-formed V2 response with fabricated evidence', async () => {
    repository.claimForProcessing.mockResolvedValue(
      ok({
        publicId: 'evaluation-id',
        jobSnapshot: buildJobSnapshotV2(jobSnapshot),
        resumeRedactedText: 'TypeScript',
        resumeRedactedHash: 'hash',
        resumeRedactionVersion: 'v1',
        model: 'gemini-model',
        promptVersion: 'v2',
      }),
    );
    llm.evaluate.mockResolvedValue(
      ok({
        schemaVersion: 2,
        evidence: {
          schemaVersion: 2,
          strengths: [],
          gaps: [],
          explanation: 'Relevant.',
          criteria: [
            {
              criterionId: 'skill:1',
              criterionText: 'Experience with TypeScript',
              verdict: 'MATCHED',
              scoreContribution: 80,
              explanation: 'Found.',
              evidence: [
                {
                  snippet: 'JavaScript',
                  section: 'resume',
                  startOffset: 0,
                  endOffset: 10,
                },
              ],
            },
          ],
        },
      }),
    );

    const error = (
      await service.process('evaluation-id', 0, 3)
    )._unsafeUnwrapErr();
    expect(error.message).toBe('Invalid evaluation V2 response');
    expect(error.cause).toEqual(
      expect.objectContaining({ code: 'V2_EVIDENCE_SNIPPET_NOT_FOUND' }),
    );
    expect(repository.markCompleted).not.toHaveBeenCalled();
    expect(repository.markPending).toHaveBeenCalledWith(
      'evaluation-id',
      'Invalid evaluation V2 response',
    );
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

  it('preserves non-Error failures while retaining background error messages', async () => {
    const failure = 'private LLM failure';
    llm.evaluate.mockResolvedValue(err(failure));
    const error = (
      await service.process('evaluation-id', 0, 3)
    )._unsafeUnwrapErr();
    expect(error.cause).toBe(failure);
    expect(error.message).toBe(failure);
    expect(repository.markPending).toHaveBeenCalledWith(
      'evaluation-id',
      failure,
    );
  });
});
