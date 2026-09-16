import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { err, ok, Result } from 'neverthrow';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';
import { CommonContentDisposition } from 'src/shared/domain/enum';
import {
  IFileStorage,
  ObjectMetadata,
  PresignedUpload,
  PresignUploadInput,
} from './file-storage.interface';

/** An upload URL grants writes to the bucket, so it expires well before a read one. */
const DEFAULT_UPLOAD_EXPIRY_SECONDS = 300;
const DEFAULT_DOWNLOAD_EXPIRY_SECONDS = 900;

@Injectable()
export class FileStorage implements IFileStorage, OnModuleDestroy {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly logger = new Logger(FileStorage.name);

  constructor(private readonly configService: ConfigService) {
    this.bucket = this.requireEnv('S3_BUCKET_NAME');
    this.s3 = new S3Client({
      region: 'auto',
      // On the default setting the SDK stamps a CRC32 of the *empty* body into
      // the presigned URL, and the real upload then fails the checksum check.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      endpoint: this.requireEnv('S3_API_ENDPOINT'),
      credentials: {
        accessKeyId: this.requireEnv('S3_ACCESS_KEY_ID'),
        secretAccessKey: this.requireEnv('S3_SECRET_ACCESS_KEY'),
      },
    });
  }

  onModuleDestroy() {
    this.s3.destroy();
  }

  async getUploadUrl(
    input: PresignUploadInput,
  ): Promise<Result<PresignedUpload, AppError>> {
    const expiresIn = input.expiresInSeconds ?? DEFAULT_UPLOAD_EXPIRY_SECONDS;

    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        ContentType: input.contentType,
        ContentLength: input.contentLength,
      });
      const url = await getSignedUrl(this.s3, command, { expiresIn });

      return ok({
        uploadUrl: url,
        key: input.key,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
      });
    } catch (error) {
      this.logger.error(
        `Failed to presign an upload for key ${input.key}.`,
        this.describe(error),
      );

      return err(
        new AppError(
          ErrorCode.InternalServerError,
          'Failed to generate presigned upload URL',
        ),
      );
    }
  }

  async getDownloadUrl(
    key: string,
    fileName: string,
    disposition: CommonContentDisposition,
    expiresInSeconds?: number,
  ): Promise<Result<string, AppError>> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: this.contentDisposition(
          fileName,
          disposition,
        ),
      });
      const url = await getSignedUrl(this.s3, command, {
        expiresIn: expiresInSeconds ?? DEFAULT_DOWNLOAD_EXPIRY_SECONDS,
      });

      return ok(url);
    } catch (error) {
      this.logger.error(
        `Failed to presign a download for key ${key}.`,
        this.describe(error),
      );

      return err(
        new AppError(
          ErrorCode.InternalServerError,
          'Failed to generate presigned download URL',
        ),
      );
    }
  }

  async getObjectMetadata(
    key: string,
  ): Promise<Result<ObjectMetadata | null, AppError>> {
    try {
      const response = await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );

      return ok({
        contentType: response.ContentType ?? null,
        contentLength: response.ContentLength ?? 0,
        lastModified: response.LastModified ?? null,
      });
    } catch (error) {
      if (this.isNotFound(error)) {
        return ok(null);
      }

      this.logger.error(
        `Failed to read metadata for key ${key}.`,
        this.describe(error),
      );

      return err(
        new AppError(
          ErrorCode.InternalServerError,
          'Failed to read object metadata',
        ),
      );
    }
  }

  async getObject(key: string): Promise<Result<Buffer, AppError>> {
    try {
      const response = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );

      if (!response.Body) {
        return err(
          new AppError(ErrorCode.NotFound, `Object has no body for key ${key}`),
        );
      }

      const bytes = await response.Body.transformToByteArray();
      return ok(Buffer.from(bytes));
    } catch (error) {
      if (this.isNotFound(error)) {
        return err(
          new AppError(ErrorCode.NotFound, `Object not found for key ${key}`),
        );
      }

      this.logger.error(
        `Failed to read object for key ${key}.`,
        this.describe(error),
      );

      return err(
        new AppError(ErrorCode.InternalServerError, 'Failed to read object'),
      );
    }
  }

  async deleteObject(key: string): Promise<Result<void, AppError>> {
    try {
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );

      return ok(undefined);
    } catch (error) {
      this.logger.error(`Failed to delete key ${key}.`, this.describe(error));

      return err(
        new AppError(ErrorCode.InternalServerError, 'Failed to delete object'),
      );
    }
  }

  /**
   * RFC 6266: `filename` has to stay ASCII, so a non-ASCII name travels in the
   * `filename*` parameter instead of being percent-encoded in place — otherwise
   * the browser saves "Báo cáo.pdf" as "B%C3%A1o%20c%C3%A1o.pdf". Dropping
   * quotes and backslashes also keeps the name inside its header parameter.
   */
  private contentDisposition(
    fileName: string,
    disposition: CommonContentDisposition,
  ): string {
    const ascii = fileName
      .replace(/[^\x20-\x7E]/g, '_')
      .replace(/["\\]/g, '')
      .trim();
    const fallback = ascii.length > 0 ? ascii : 'download';

    return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  }

  private isNotFound(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }

    const { name, $metadata } = error as {
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };

    return (
      name === 'NotFound' ||
      name === 'NoSuchKey' ||
      $metadata?.httpStatusCode === 404
    );
  }

  private describe(error: unknown): string {
    return error instanceof Error
      ? (error.stack ?? error.message)
      : String(error);
  }

  private requireEnv(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
  }
}
