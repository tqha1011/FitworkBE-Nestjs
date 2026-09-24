import Ajv from 'ajv';
import {
  ApplicantEvaluationLlmOutput,
  ApplicantEvaluationLlmOutputV2,
} from '../../application/interfaces/applicant-evaluation-llm.interface';
import {
  APPLICANT_EVALUATION_RESPONSE_SCHEMA,
  APPLICANT_EVALUATION_RESPONSE_SCHEMA_V2,
} from './applicant-evaluation-response.schema';

const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile<ApplicantEvaluationLlmOutput>(
  APPLICANT_EVALUATION_RESPONSE_SCHEMA,
);
const validateV2 = ajv.compile<ApplicantEvaluationLlmOutputV2>(
  APPLICANT_EVALUATION_RESPONSE_SCHEMA_V2,
);

export function validateApplicantEvaluationOutput(
  value: unknown,
): value is ApplicantEvaluationLlmOutput {
  return validate(value);
}

export function validateApplicantEvaluationOutputV2(
  value: unknown,
): value is ApplicantEvaluationLlmOutputV2 {
  return validateV2(value);
}
