import Ajv from 'ajv';
import { ApplicantEvaluationLlmOutput } from '../../application/interfaces/applicant-evaluation-llm.interface';
import { APPLICANT_EVALUATION_RESPONSE_SCHEMA } from './applicant-evaluation-response.schema';

const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile<ApplicantEvaluationLlmOutput>(
  APPLICANT_EVALUATION_RESPONSE_SCHEMA,
);

export function validateApplicantEvaluationOutput(
  value: unknown,
): value is ApplicantEvaluationLlmOutput {
  return validate(value);
}
