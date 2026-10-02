export type ApplicantEvaluationJobDto = {
  evaluationPublicId: string;
  telemetry?: {
    traceparent?: string;
    tracestate?: string;
  };
};
