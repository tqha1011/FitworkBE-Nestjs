import { Result } from 'neverthrow';
import { AppError } from 'src/shared/common/errorCode';
import { CommonContentDisposition } from 'src/shared/domain/enum';

export type PresignUploadInput = {
  key: string;
  contentType: string;
  contentLength: number;
  expiresInSeconds?: number;
  /** Absolute deadline shared with demo upload tracking; never extended by a lock wait. */
  expiresAt?: Date;
};

export type PresignedUpload = {
  uploadUrl: string;
  key: string;
  expiresAt: Date;
};

export type ObjectMetadata = {
  contentType: string | null;
  contentLength: number;
  lastModified: Date | null;
};

export abstract class IFileStorage {
  /**
   * Only `content-length` lands in the signed headers, so the storage provider
   * rejects a mis-sized upload but accepts any content type. Callers must read
   * the stored type back with {@link GetObjectMetadata} instead of trusting the
   * one they signed.
   */
  abstract getUploadUrl(
    input: PresignUploadInput,
  ): Promise<Result<PresignedUpload, AppError>>;

  /** `fileName` is what the browser saves the file as; it is not part of the key. */
  abstract getDownloadUrl(
    key: string,
    fileName: string,
    disposition: CommonContentDisposition,
    expiresInSeconds?: number,
  ): Promise<Result<string, AppError>>;

  /** ok(null) when the object does not exist; err only on infrastructure failure. */
  abstract getObjectMetadata(
    key: string,
  ): Promise<Result<ObjectMetadata | null, AppError>>;

  /** Reads the full object body — for server-side use (e.g. parsing a file
   * for ingestion), unlike GetDownloadUrl which only signs a browser link. */
  abstract getObject(key: string): Promise<Result<Buffer, AppError>>;

  abstract deleteObject(key: string): Promise<Result<void, AppError>>;
}
