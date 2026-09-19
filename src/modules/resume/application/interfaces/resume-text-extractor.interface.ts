import { Result } from 'neverthrow';
import { CommonFileType } from 'src/shared/domain/enum';

export abstract class IResumeTextExtractor {
  abstract parserVersion(fileType: CommonFileType): string;

  abstract extract(
    fileType: CommonFileType,
    buffer: Buffer,
  ): Promise<Result<string, Error>>;
}
