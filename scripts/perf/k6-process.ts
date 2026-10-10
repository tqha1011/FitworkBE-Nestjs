import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { MetricPoint, PointCollector, redact } from './k6-support';
import type { K6Config } from './k6/workload';

type ApplicantPool = {
  accounts: { email: string; publicId: string }[];
  password: string;
};
function validateApplicants(config: K6Config, applicants?: ApplicantPool) {
  if (config.profile !== 'applicant') return;
  const accounts = applicants?.accounts ?? [];
  if (
    !applicants?.password ||
    accounts.length < config.vus ||
    accounts.some((account) => !account.email || !account.publicId) ||
    new Set(accounts.map((account) => account.email)).size !==
      accounts.length ||
    new Set(accounts.map((account) => account.publicId)).size !==
      accounts.length
  )
    throw new Error(
      'Applicant account pool must contain a password and enough unique identities for every VU',
    );
}
const shellQuote = (value: string) =>
  "'" + value.replaceAll("'", "'\\''") + "'";

// Buffer complete lines so passwords/JWTs split across pipe chunks are never
// partially emitted. Carriage returns retain k6 progress updates.
export function createK6Output(
  write: (text: string) => void,
  secrets: string[],
) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  return {
    write(chunk: Buffer) {
      pending += decoder.write(chunk);
      const end =
        Math.max(pending.lastIndexOf('\n'), pending.lastIndexOf('\r')) + 1;
      if (end) {
        write(redact(pending.slice(0, end), secrets));
        pending = pending.slice(end);
      }
    },
    end() {
      pending += decoder.end();
      if (pending) write(redact(pending, secrets));
      pending = '';
    },
  };
}

export async function prepareK6Files(
  configs: K6Config[],
  directory: string,
  applicants: ApplicantPool,
) {
  for (const config of configs) validateApplicants(config, applicants);
  const accountsPath = resolve(directory, 'applicant-accounts.json');
  await writeFile(
    accountsPath,
    JSON.stringify(applicants.accounts, null, 2) + '\n',
    { mode: 0o600 },
  );
  const prepared = [];
  for (const config of configs) {
    const configPath = resolve(directory, `${config.id}.config.json`);
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', {
      mode: 0o600,
    });
    const command = [
      `K6_CONFIG=${shellQuote(configPath)}`,
      `K6_APPLICANT_ACCOUNTS_FILE=${shellQuote(accountsPath)}`,
      'k6 run --no-usage-report',
      '--new-machine-readable-summary',
      `--out ${shellQuote(`json=${resolve(directory, `${config.id}.metrics.jsonl`)}`)}`,
      `--summary-export ${shellQuote(resolve(directory, `${config.id}.summary.json`))}`,
      shellQuote(resolve('scripts/perf/k6/job-search.js')),
    ].join(' ');
    prepared.push({ configPath, accountsPath, command });
  }
  return prepared;
}

export async function runK6(
  config: K6Config,
  directory: string,
  token: string,
  signal: AbortSignal,
  secrets: string[],
  applicants?: ApplicantPool,
) {
  validateApplicants(config, applicants);
  const configPath = resolve(directory, `${config.id}.config.json`);
  const rawPath = resolve(directory, `${config.id}.metrics.jsonl`);
  const summaryPath = resolve(directory, `${config.id}.summary.json`);
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', {
    mode: 0o600,
  });
  if (signal.aborted) throw new Error('Run interrupted before k6 start');
  const args = [
    'run',
    ...(config.profile === 'applicant'
      ? ['--new-machine-readable-summary']
      : []),
    '--summary-export',
    summaryPath,
    '--out',
    `json=${rawPath}`,
    '--no-usage-report',
    resolve('scripts/perf/k6/job-search.js'),
  ];
  const result = await new Promise<{
    code: number | null;
    signal: string | null;
    log: string;
  }>((resolveResult, reject) => {
    const child = spawn('k6', args, {
      // Never pass DB passwords, application secrets, debug flags or extra k6 outputs.
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        ACCESS_TOKEN: token,
        K6_CONFIG: configPath,
        K6_NO_USAGE_REPORT: 'true',
        K6_LOG_FORMAT: 'raw',
        ...(applicants
          ? {
              K6_APPLICANT_ACCOUNTS: JSON.stringify(applicants.accounts),
              K6_APPLICANT_PASSWORD: applicants.password,
            }
          : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let log = '';
    const append = (sanitized: string) => {
      log = (log + sanitized).slice(-16000);
      process.stdout.write(sanitized);
    };
    const outputSecrets = [...secrets, token, applicants?.password ?? ''];
    const stdout = createK6Output(append, outputSecrets);
    const stderr = createK6Output(append, outputSecrets);
    child.stdout.on('data', (data: Buffer) => stdout.write(data));
    child.stderr.on('data', (data: Buffer) => stderr.write(data));
    let killTimer: NodeJS.Timeout | undefined;
    const abort = () => {
      child.kill('SIGINT');
      killTimer = setTimeout(
        () => child.kill('SIGKILL'),
        config.gracefulStopMs + 2000,
      );
    };
    signal.addEventListener('abort', abort, { once: true });
    child.on('error', reject);
    child.on('close', (code, childSignal) => {
      stdout.end();
      stderr.end();
      if (killTimer) clearTimeout(killTimer);
      signal.removeEventListener('abort', abort);
      resolveResult({ code, signal: childSignal, log });
    });
  });
  // Only sanitized diagnostics are written; JSON metrics contain no headers/body.
  await writeFile(
    resolve(directory, `${config.id}.log`),
    redact(result.log, secrets),
  );
  const collector = new PointCollector(
    config.profile !== 'matrix'
      ? config.queries.map((query) => query.name)
      : [config.criterion!],
  );
  let truncatedLines = 0;
  try {
    const lines = createInterface({
      input: createReadStream(rawPath),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      try {
        collector.add(JSON.parse(line) as MetricPoint);
      } catch {
        truncatedLines++;
      }
    }
  } catch {
    truncatedLines++;
  }
  const complete = result.code === 0 && !signal.aborted && truncatedLines === 0;
  const report = collector.finish(config, complete);
  await writeFile(
    resolve(directory, `${config.id}.result.json`),
    JSON.stringify(
      {
        ...report,
        exitCode: result.code,
        signal: result.signal,
        truncatedLines,
      },
      null,
      2,
    ) + '\n',
  );
  return {
    report,
    authStatus: collector.authStatus,
    exitCode: result.code,
    truncatedLines,
  };
}
