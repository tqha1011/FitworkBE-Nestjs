export enum SystemRole {
  Admin = 'admin',
  User = 'user',
}

export enum CommonUserRole {
  ROLE_APPLICANT = 'ROLE_APPLICANT',
  ROLE_COMPANY = 'ROLE_COMPANY',
}

export enum CommonJobStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

export enum CommonJobApplicantStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  COMPLETED = 'COMPLETED',
}

export enum CommonCurrency {
  VND = 'VND',
  USD = 'USD',
}

export enum CommonContentDisposition {
  ATTACHMENT = 'attachment',
  INLINE = 'inline',
}

export enum CommonFileType {
  PDF = 'pdf',
  DOCX = 'docx',
}

export enum CommonResumeIngestionStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum CommonEvaluationStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}
