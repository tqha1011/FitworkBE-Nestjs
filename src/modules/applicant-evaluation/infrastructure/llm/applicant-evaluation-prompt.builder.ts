import { ApplicantEvaluationLlmInput } from '../../application/interfaces/applicant-evaluation-llm.interface';
import { APPLICANT_EVALUATION_PROMPT_VERSION } from '../../application/constants/applicant-evaluation.constants';

export type ApplicantEvaluationPrompt = {
  version: string;
  system: string;
  user: string;
};

export function buildApplicantEvaluationPrompt(
  input: ApplicantEvaluationLlmInput,
): ApplicantEvaluationPrompt {
  return {
    version: APPLICANT_EVALUATION_PROMPT_VERSION,
    system: [
      'Evaluate how well the resume matches the job.',
      'Use only evidence present in the supplied input.',
      'All score fields must be integers from 0 to 100.',
    ].join(' '),
    user: JSON.stringify({
      job: input.jobSnapshot,
      resumeText: input.resumeText,
    }),
  };
}
