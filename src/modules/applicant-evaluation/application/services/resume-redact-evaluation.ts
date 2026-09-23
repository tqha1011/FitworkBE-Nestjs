import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { err, ok, Result } from 'neverthrow';
import {
  IResumeRedactEvaluation,
  ResumeEvaluationSnapshot,
} from '../interfaces/resume-redact-evaluation.interface';
import { IResumeContentRepository } from 'src/modules/resume/domain/repositories/resume-content.repo.interface';
import { CommonResumeIngestionStatus } from 'src/shared/domain/enum';

const REDACTION_VERSION = 'resume-redaction-v1' as const;
const REDACTED_NAME = '[REDACTED NAME]';
const REDACTED_CONTACT = '[REDACTED CONTACT]';
const REDACTED_ADDRESS = '[REDACTED ADDRESS]';

const EMAIL_PATTERN = /[\w.+%-]+@[\w.-]+\.[A-Za-z]{2,}/gu;
const URL_PATTERN =
  /(?:https?:\/\/|www\.|(?:linkedin|github)\.com\/)[^\s<>()]+/giu;
const PHONE_PATTERN =
  /(?<![\p{L}\p{N}])\+?\d[\d\t ().-]{7,}\d(?![\p{L}\p{N}])/gu;
const CONTACT_SIGNAL_PATTERN =
  /[\w.+%-]+@[\w.-]+\.[A-Za-z]{2,}|https?:\/\/|www\.|(?:linkedin|github)\.com\//iu;
const CONTACT_LABEL_PATTERN =
  /^(?:full\s*name|name|họ\s*(?:và\s*)?tên|email|e-mail|phone|mobile|điện\s*thoại|số\s*điện\s*thoại|linkedin|github|portfolio)\s*[:：-]\s*.+$/iu;
const ADDRESS_LABEL_PATTERN = /^(?:address|địa\s*chỉ)\s*[:：-]\s*.+$/iu;
const ADDRESS_LINE_PATTERN =
  /^\d{1,5}\s+.+(?:đường|phố|phường|quận|street|road|district|ward)(?:\s|,|$).*$/iu;
const SECTION_HEADING_PATTERN =
  /^(?:summary|profile|experience|skills|education|projects|certifications|tóm\s*tắt|kinh\s*nghiệm|kỹ\s*năng|học\s*vấn|dự\s*án|chứng\s*chỉ)(?:\s|:|$)/iu;
const JOB_TITLE_PATTERN =
  /(?:engineer|developer|intern|designer|manager|analyst|architect|consultant|scientist|kỹ\s*sư|lập\s*trình\s*viên|thực\s*tập\s*sinh)/iu;
const NAME_LINE_PATTERN = /^[\p{L}\p{M}]+(?:[ '-][\p{L}\p{M}]+){1,4}$/u;

function redactPhoneNumbers(text: string): string {
  return text.replace(PHONE_PATTERN, (candidate) => {
    const digitCount = candidate.replace(/\D/g, '').length;
    return digitCount >= 9 && digitCount <= 15 ? REDACTED_CONTACT : candidate;
  });
}

function redactHeader(text: string): string {
  const lines = text.split('\n');
  const headingIndex = lines.findIndex((line) =>
    SECTION_HEADING_PATTERN.test(line.trim()),
  );
  const headerEnd = Math.min(
    headingIndex === -1 ? lines.length : headingIndex,
    8,
  );
  const firstNonemptyIndex = lines.findIndex((line) => line.trim().length > 0);
  const hasNearbyContact = lines
    .slice(0, Math.min(headerEnd, 6))
    .some(
      (line) =>
        CONTACT_SIGNAL_PATTERN.test(line) ||
        CONTACT_LABEL_PATTERN.test(line.trim()),
    );

  for (let index = 0; index < headerEnd; index += 1) {
    const trimmed = lines[index].trim();
    if (
      ADDRESS_LABEL_PATTERN.test(trimmed) ||
      ADDRESS_LINE_PATTERN.test(trimmed)
    ) {
      lines[index] = REDACTED_ADDRESS;
    } else if (CONTACT_LABEL_PATTERN.test(trimmed)) {
      lines[index] = REDACTED_CONTACT;
    } else if (
      index === firstNonemptyIndex &&
      hasNearbyContact &&
      NAME_LINE_PATTERN.test(trimmed) &&
      !JOB_TITLE_PATTERN.test(trimmed)
    ) {
      lines[index] = REDACTED_NAME;
    }
  }

  return lines.join('\n');
}

/** Best effort for text CVs; names outside the contact header may remain. */
export function createResumeEvaluationSnapshot(
  extractedText: string,
): ResumeEvaluationSnapshot {
  const normalized = extractedText
    .replace(/\r\n?/g, '\n')
    .replace(/\0/g, '')
    .trim();
  if (!normalized) {
    throw new Error('Resume text is empty after normalization');
  }

  const text = redactPhoneNumbers(
    redactHeader(normalized)
      .replace(EMAIL_PATTERN, REDACTED_CONTACT)
      .replace(URL_PATTERN, REDACTED_CONTACT),
  );

  return {
    text,
    hash: createHash('sha256').update(text, 'utf8').digest('hex'),
    redactionVersion: REDACTION_VERSION,
  };
}

@Injectable()
export class ResumeRedactEvaluation implements IResumeRedactEvaluation {
  constructor(private readonly resumeRepository: IResumeContentRepository) {}

  async redactResumeAsync(
    resumeContentPublicId: string,
  ): Promise<Result<ResumeEvaluationSnapshot, Error>> {
    const result = await this.resumeRepository.getByPublicId(
      resumeContentPublicId,
    );
    if (result.isErr()) {
      return err(new Error('Failed to load resume content for evaluation'));
    }
    if (
      !result.value ||
      result.value.status !== CommonResumeIngestionStatus.COMPLETED ||
      !result.value.extractedText
    ) {
      return err(new Error('Completed resume content is unavailable'));
    }

    try {
      return ok(createResumeEvaluationSnapshot(result.value.extractedText));
    } catch {
      return err(new Error('Failed to create resume evaluation snapshot'));
    }
  }
}
