export enum ResumeDomainError {
  InvalidStoragePath = 'INVALID_STORAGE_PATH',
  InvalidFileSize = 'INVALID_FILE_SIZE',
  InvalidFileType = 'INVALID_FILE_TYPE',
  InvalidFileName = 'INVALID_FILE_NAME',
  InvalidUserId = 'INVALID_USER_ID',
}

export class ResumeDomainErrorValidation extends Error {
  constructor(
    public readonly error: ResumeDomainError,
    message: string,
  ) {
    super(message);
  }
}
