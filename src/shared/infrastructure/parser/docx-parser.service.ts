import { Injectable, Logger } from '@nestjs/common';
import mammoth from 'mammoth';
import { err, ok, Result } from 'neverthrow';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';

@Injectable()
export class DocxParserService {
  private readonly logger = new Logger(DocxParserService.name);
  async parseDocx(buffer: Buffer): Promise<Result<string, AppError>> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return ok(result.value);
    } catch (error) {
      this.logger.error(`Error parsing DOCX: ${error}`);
      return err(
        new AppError(ErrorCode.InternalServerError, 'Failed to parse DOCX'),
      );
    }
  }
}
