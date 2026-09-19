import { ok } from 'neverthrow';
import { CommonFileType } from 'src/shared/domain/enum';
import { DocxParserService } from 'src/shared/infrastructure/parser/docx-parser.service';
import { PDFParserService } from 'src/shared/infrastructure/parser/pdf-parser.service';
import {
  DOCX_PARSER_VERSION,
  PDF_PARSER_VERSION,
  ResumeTextExtractor,
} from './resume-text-extractor';

describe('ResumeTextExtractor', () => {
  const buffer = Buffer.from('file');
  let pdfParser: { parsePDF: jest.Mock };
  let docxParser: { parseDocx: jest.Mock };
  let extractor: ResumeTextExtractor;

  beforeEach(() => {
    pdfParser = { parsePDF: jest.fn().mockResolvedValue(ok('pdf text')) };
    docxParser = { parseDocx: jest.fn().mockResolvedValue(ok('docx text')) };
    extractor = new ResumeTextExtractor(
      pdfParser as unknown as PDFParserService,
      docxParser as unknown as DocxParserService,
    );
  });

  it('routes PDF extraction and exposes its pinned parser version', async () => {
    const result = await extractor.extract(CommonFileType.PDF, buffer);

    expect(result.isOk() && result.value).toBe('pdf text');
    expect(pdfParser.parsePDF).toHaveBeenCalledWith(buffer);
    expect(extractor.parserVersion(CommonFileType.PDF)).toBe(
      PDF_PARSER_VERSION,
    );
  });

  it('routes DOCX extraction and exposes its pinned parser version', async () => {
    const result = await extractor.extract(CommonFileType.DOCX, buffer);

    expect(result.isOk() && result.value).toBe('docx text');
    expect(docxParser.parseDocx).toHaveBeenCalledWith(buffer);
    expect(extractor.parserVersion(CommonFileType.DOCX)).toBe(
      DOCX_PARSER_VERSION,
    );
  });
});
