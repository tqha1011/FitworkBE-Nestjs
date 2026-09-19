import { buildApplicantEvaluationPrompt } from './applicant-evaluation-prompt.builder';

describe('buildApplicantEvaluationPrompt', () => {
  it('keeps job and resume data in a JSON user message', () => {
    const prompt = buildApplicantEvaluationPrompt({
      jobSnapshot: {
        schemaVersion: 1,
        publicId: 'job-id',
        title: 'Backend Engineer',
        description: 'Build backend services',
        requirements: 'TypeScript and NestJS',
        location: 'Remote',
        skills: [{ id: 1, name: 'TypeScript' }],
        category: { id: 2, name: 'Engineering' },
        arrangement: { id: 3, name: 'Remote' },
      },
      resumeText: 'Five years of TypeScript experience.',
    });

    expect(JSON.parse(prompt.user)).toEqual({
      job: {
        schemaVersion: 1,
        publicId: 'job-id',
        title: 'Backend Engineer',
        description: 'Build backend services',
        requirements: 'TypeScript and NestJS',
        location: 'Remote',
        skills: [{ id: 1, name: 'TypeScript' }],
        category: { id: 2, name: 'Engineering' },
        arrangement: { id: 3, name: 'Remote' },
      },
      resumeText: 'Five years of TypeScript experience.',
    });
  });
});
