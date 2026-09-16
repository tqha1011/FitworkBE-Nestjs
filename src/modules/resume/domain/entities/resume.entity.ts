import { randomUUID } from 'crypto';
import { err, ok, Result } from 'neverthrow';
import {
  ResumeDomainError,
  ResumeDomainErrorValidation,
} from '../errors/resume-domain.error';
import { CommonFileType } from 'src/shared/domain/enum';

export const MAX_RESUME_FILE_SIZE = 5 * 1024 * 1024;

export type ResumeGetParams = {
  readonly id: number;
  readonly publicId: string;
  readonly storagePath: string;
  readonly fileSize: number;
  readonly fileType: CommonFileType;
  readonly fileName: string;
  readonly userId: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type ResumeCreateParams = Omit<
  ResumeGetParams,
  'id' | 'publicId' | 'createdAt' | 'updatedAt'
>;

export class Resume {
  private constructor(private readonly params: ResumeGetParams) {}

  static create(
    params: ResumeCreateParams,
  ): Result<Resume, ResumeDomainErrorValidation> {
    const validationResult = Resume.validate(params);
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }

    const now = new Date();
    return ok(
      new Resume({
        ...params,
        id: 0,
        publicId: randomUUID(),
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  static restore(params: ResumeGetParams): Resume {
    return new Resume(params);
  }

  private static validate(
    params: ResumeCreateParams,
  ): Result<undefined, ResumeDomainErrorValidation> {
    if (!params.storagePath.trim()) {
      return err(
        new ResumeDomainErrorValidation(
          ResumeDomainError.InvalidStoragePath,
          'storagePath must not be empty',
        ),
      );
    }

    if (
      !Number.isInteger(params.fileSize) ||
      params.fileSize <= 0 ||
      params.fileSize > MAX_RESUME_FILE_SIZE
    ) {
      return err(
        new ResumeDomainErrorValidation(
          ResumeDomainError.InvalidFileSize,
          `fileSize must be between 1 and ${MAX_RESUME_FILE_SIZE} bytes`,
        ),
      );
    }

    if (!Object.values(CommonFileType).includes(params.fileType)) {
      return err(
        new ResumeDomainErrorValidation(
          ResumeDomainError.InvalidFileType,
          'fileType must be one of the following: PDF, DOCX',
        ),
      );
    }

    if (!params.fileName.trim()) {
      return err(
        new ResumeDomainErrorValidation(
          ResumeDomainError.InvalidFileName,
          'fileName must not be empty',
        ),
      );
    }

    if (!Number.isInteger(params.userId) || params.userId <= 0) {
      return err(
        new ResumeDomainErrorValidation(
          ResumeDomainError.InvalidUserId,
          'userId must be a positive integer',
        ),
      );
    }

    return ok(undefined);
  }

  get id(): number {
    return this.params.id;
  }

  get publicId(): string {
    return this.params.publicId;
  }

  get storagePath(): string {
    return this.params.storagePath;
  }

  get fileSize(): number {
    return this.params.fileSize;
  }

  get fileType(): CommonFileType {
    return this.params.fileType;
  }

  get fileName(): string {
    return this.params.fileName;
  }

  get userId(): number {
    return this.params.userId;
  }

  get createdAt(): Date {
    return this.params.createdAt;
  }

  get updatedAt(): Date {
    return this.params.updatedAt;
  }
}
