type Diagnostic = {
  error_type: string;
  error_message: string;
  error_code?: string;
  error_stack?: string;
};

/** Redact known credential/PII forms before truncating any diagnostic text. */
export function redactDiagnosticText(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex -- Strip ANSI color escape sequences from diagnostics.
      .replace(/\u001b\[[0-9;]*m/g, '')
      .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, '[REDACTED_URL]')
      .replace(
        /["']?\b(?:authorization|cookie|set-cookie)\b["']?\s*[:=]\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n]*)/gi,
        '[REDACTED_HEADER]',
      )
      .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
      .replace(
        /(["']?\b(?:password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|api[_-]?key|secret)\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}&]+)/gi,
        '$1[REDACTED]',
      )
      .replace(
        /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
        '[REDACTED_TOKEN]',
      )
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
      .replace(
        /(?<![\w])\+?\d(?:[ .()-]*\d){9,14}(?![\w])/g,
        '[REDACTED_PHONE]',
      )
  );
}

function safeIdentifier(value: unknown): string | undefined {
  return typeof value === 'string' &&
    /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/.test(value)
    ? value
    : undefined;
}

function describe(error: unknown, includeStack: boolean): Diagnostic {
  if (!(error instanceof Error) && typeof error !== 'string') {
    return { error_type: 'UnknownError', error_message: 'Non-Error exception' };
  }
  const type =
    error instanceof Error ? (safeIdentifier(error.name) ?? 'Error') : 'Error';
  const details =
    error instanceof Error
      ? (error as Error & { code?: unknown; meta?: unknown })
      : undefined;
  const code = safeIdentifier(details?.code);
  const isPrisma =
    type.startsWith('PrismaClient') || /^P\d{4}$/.test(code ?? '');
  let message: string;
  if (isPrisma) {
    // Prisma messages include query invocations and user-provided values.
    // Only stable error codes and schema identifiers are safe to retain.
    message = `${type}${code ? ` (${code})` : ''}`;
    if (details?.meta && typeof details.meta === 'object') {
      const meta = details.meta as Record<string, unknown>;
      for (const key of ['modelName', 'table', 'column']) {
        const identifier = safeIdentifier(meta[key]);
        if (identifier) message += ` ${key}=${identifier}`;
      }
    }
  } else {
    let raw = typeof error === 'string' ? error : error.message;
    // JSON.parse errors can quote the response, including arbitrary resume text.
    if (type === 'SyntaxError' && /\bJSON\b/i.test(raw)) raw = 'Invalid JSON';
    // Drop multiline payload/source dumps, SQL and raw paths from summaries.
    message =
      redactDiagnosticText(raw)
        .split(/\r?\n/)
        .find((line) => line.trim())
        ?.trim() ?? 'Unknown error';
    message = message
      .replace(
        /\b(?:SELECT\b[^\r\n]*?\bFROM\b|INSERT\s+INTO\b|UPDATE\s+[\w."`]+\s+SET\b|DELETE\s+FROM\b|WITH\s+[\w"`]+\s+AS\s*\()[\s\S]*/gi,
        '[REDACTED_QUERY]',
      )
      .replace(/\/(?:[\w.%-]+\/)*[\w.%-]+/g, '[REDACTED_PATH]');
  }
  const diagnostic: Diagnostic = {
    error_type: type,
    error_message: message.slice(0, 2000),
  };
  if (code) diagnostic.error_code = code;
  if (
    includeStack &&
    error instanceof Error &&
    typeof error.stack === 'string'
  ) {
    const frames = error.stack
      .split(/\r?\n/)
      .filter((line) =>
        /^\s*at\s+.+(?::\d+:\d+\)?|\(<anonymous>\)|native)$/.test(line),
      )
      .slice(0, 20)
      .map((line) => redactDiagnosticText(line));
    diagnostic.error_stack = [`${type}: ${diagnostic.error_message}`, ...frames]
      .join('\n')
      .slice(0, 8000);
  }
  return diagnostic;
}

export function errorDiagnostics(
  error: unknown,
  includeStack = true,
): Record<string, string> {
  try {
    const chain: Diagnostic[] = [];
    const seen = new Set<unknown>();
    let current = error;
    for (let depth = 0; depth < 4 && !seen.has(current); depth++) {
      seen.add(current);
      chain.push(describe(current, includeStack));
      if (!(current instanceof Error) || current.cause === undefined) break;
      current = current.cause;
    }
    const root = chain[chain.length - 1];
    return { ...root, error_causes: JSON.stringify(chain) };
  } catch {
    // Error properties may be getters supplied by an untrusted dependency.
    const fallback = {
      error_type: 'UnknownError',
      error_message: 'Unreadable exception',
    };
    return { ...fallback, error_causes: JSON.stringify([fallback]) };
  }
}
