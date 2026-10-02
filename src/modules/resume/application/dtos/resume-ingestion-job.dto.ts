export type ResumeIngestionJobDto = {
  resumePublicId: string;
  resumeContentPublicId: string;
  telemetry?: {
    traceparent?: string;
    tracestate?: string;
    requestId?: string;
  };
};
