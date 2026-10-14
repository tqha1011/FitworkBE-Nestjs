export type ApplicantEvaluationJobDto = {
  demo?: boolean;
  evaluationPublicId: string;
  telemetry?: {
    traceparent?: string;
    tracestate?: string;
    requestId?: string;
  };
};
