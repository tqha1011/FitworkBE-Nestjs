import { Injectable, Logger } from '@nestjs/common';
import { Result, err, ok } from 'neverthrow';
import { PDFParse } from 'pdf-parse';
import { AppError, ErrorCode } from 'src/shared/common/errorCode';

@Injectable()
export class PDFParserService {
  private readonly logger = new Logger(PDFParserService.name);
  async parsePDF(buffer: Buffer): Promise<Result<string, AppError>> {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return ok(result.text);
    } catch (error) {
      this.logger.error(`Error parsing PDF: ${error}`);
      return err(
        new AppError(ErrorCode.InternalServerError, 'Failed to parse PDF'),
      );
    } finally {
      await parser.destroy();
    }
  }
}
