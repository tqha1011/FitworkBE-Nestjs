import { Injectable } from '@nestjs/common';
import { err, Result } from 'neverthrow';
import { CommonFileType } from 'src/shared/domain/enum';
import { DocxParserService } from 'src/shared/infrastructure/parser/docx-parser.service';
import { PDFParserService } from 'src/shared/infrastructure/parser/pdf-parser.service';
import { IResumeTextExtractor } from '../application/interfaces/resume-text-extractor.interface';

export const PDF_PARSER_VERSION = 'pdf-parse@2.4.5/text-v1';
export const DOCX_PARSER_VERSION = 'mammoth@1.12.3/text-v1';

@Injectable()
export class ResumeTextExtractor implements IResumeTextExtractor {
  constructor(
    private readonly pdfParser: PDFParserService,
    private readonly docxParser: DocxParserService,
  ) {}

  parserVersion(fileType: CommonFileType): string {
    switch (fileType) {
      case CommonFileType.PDF:
        return PDF_PARSER_VERSION;
      case CommonFileType.DOCX:
        return DOCX_PARSER_VERSION;
      default:
        throw new Error(`Unsupported resume file type: ${String(fileType)}`);
    }
  }

  async extract(
    fileType: CommonFileType,
    buffer: Buffer,
  ): Promise<Result<string, Error>> {
    switch (fileType) {
      case CommonFileType.PDF:
        return this.pdfParser.parsePDF(buffer);
      case CommonFileType.DOCX:
        return this.docxParser.parseDocx(buffer);
      default:
        return err(
          new Error(`Unsupported resume file type: ${String(fileType)}`),
        );
    }
  }
}
