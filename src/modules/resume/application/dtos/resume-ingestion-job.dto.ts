export type ResumeIngestionJobDto = {
  resumePublicId: string;
  resumeContentPublicId: string;
  telemetry?: {
    traceparent?: string;
  };
};
