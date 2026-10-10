import http from 'k6/http';
import { check, sleep } from 'k6';
import exec from 'k6/execution';
import encoding from 'k6/encoding';
import { SharedArray } from 'k6/data';
import { Counter, Trend } from 'k6/metrics';
import {
  buildOptions,
  mixedIndex,
  validPage,
  sessionFromLogin,
  thinkTimeSeconds,
} from './workload.ts';

if (!__ENV.K6_CONFIG)
  throw new Error(
    'K6_CONFIG is required; use bench:applicant:k6 -- --prepare-only first.',
  );
const config = JSON.parse(open(__ENV.K6_CONFIG));
export const options = buildOptions(config);
const started = new Counter('job_search_started');
const sample = new Trend('job_search_sample', true);
const measuredSample = new Trend('job_search_measured', true);
const loginStarted = new Counter('job_login_started');
const loginSample = new Trend('job_login_sample', true);
const loginSetupEnded = new Trend('job_login_setup_ended', true);
const sessionEnded = new Trend('job_session_ended');
const applicants = new SharedArray('applicant-accounts', () => {
  const accounts = JSON.parse(
    __ENV.K6_APPLICANT_ACCOUNTS_FILE
      ? open(__ENV.K6_APPLICANT_ACCOUNTS_FILE)
      : __ENV.K6_APPLICANT_ACCOUNTS || '[]',
  );
  if (
    config.profile === 'applicant' &&
    (!__ENV.K6_APPLICANT_PASSWORD ||
      !Array.isArray(accounts) ||
      accounts.length < config.vus ||
      accounts.some((a) => !a.email || !a.publicId) ||
      new Set(accounts.map((a) => a.email)).size !== accounts.length ||
      new Set(accounts.map((a) => a.publicId)).size !== accounts.length)
  )
    throw new Error(
      'Applicant mode requires K6_APPLICANT_PASSWORD and enough unique prepared accounts.',
    );
  return accounts;
});
let session;

export function setup() {
  if (config.profile !== 'applicant') return;
  const epoch = Date.now();
  const sessions = [];
  console.log(
    `Preparing ${config.vus} applicant sessions (at most 10 concurrent logins); search has not started.`,
  );
  for (let offset = 0; offset < config.vus; offset += 10) {
    const accounts = applicants.slice(
      offset,
      Math.min(offset + 10, config.vus),
    );
    const tags = accounts.map((_account, index) => ({
      name: 'applicant-login',
      phase: 'setup',
      vu: String(offset + index + 1),
      epoch: String(epoch),
    }));
    const requests = accounts.map((account, index) => {
      loginStarted.add(1, tags[index]);
      return {
        method: 'POST',
        url: `${config.apiBaseUrl}/api/auth/login`,
        body: JSON.stringify({
          email: account.email,
          password: __ENV.K6_APPLICANT_PASSWORD,
        }),
        params: {
          headers: { 'Content-Type': 'application/json' },
          timeout: `${config.timeoutMs}ms`,
          redirects: 0,
          tags: tags[index],
        },
      };
    });
    const responses = http.batch(requests);
    let failure;
    responses.forEach((response, index) => {
      let payload;
      try {
        payload = response.json();
      } catch {
        payload = null;
      }
      const prepared =
        response.status === 200
          ? sessionFromLogin(
              payload,
              accounts[index].publicId,
              Date.now(),
              (value) => encoding.b64decode(value, 'rawurl', 's'),
            )
          : null;
      check(
        response,
        { 'Login returns the correct applicant session': () => !!prepared },
        tags[index],
      );
      loginSample.add(response.timings.duration, {
        ...tags[index],
        status: String(response.status),
        valid: String(!!prepared),
        timeout: String(response.error_code === 1050),
        ended: String(Date.now() - epoch),
      });
      sessions.push(prepared);
      if (!prepared && !failure)
        failure =
          response.status !== 200
            ? `Applicant setup login HTTP ${response.status}: check API, account password/permissions; no search was started.`
            : 'Applicant setup login returned an invalid identity or token payload; no search was started.';
    });
    if (failure) {
      loginSetupEnded.add(Date.now() - epoch, {
        epoch: String(epoch),
        phase: 'setup',
      });
      exec.test.abort(failure);
    }
  }
  // Validate the earliest token after the whole pool is ready. No auth traffic
  // is allowed during the warm-up, measurement or final request drain.
  const searchBudget =
    (config.smoke ? 60000 : config.warmupMs + config.durationMs) +
    config.gracefulStopMs +
    config.timeoutMs +
    5000;
  if (
    sessions.some(
      (prepared) => prepared.expiresAtMs <= Date.now() + searchBudget,
    )
  )
    exec.test.abort(
      'Applicant setup token expiry is too short for the complete search workload; obtain longer-lived tokens and prepare again.',
    );
  loginSetupEnded.add(Date.now() - epoch, {
    epoch: String(epoch),
    phase: 'setup',
  });
  console.log(
    `All ${sessions.length} applicants logged in. Starting search warm-up, then measurement; use job_search_measured for valid measured search latency.`,
  );
  return { sessions };
}

export function search(data) {
  const isApplicant = config.profile === 'applicant';
  if (isApplicant) {
    session ||= data?.sessions?.[exec.vu.idInTest - 1];
    if (!session || session.expiresAtMs <= Date.now() + config.timeoutMs)
      exec.test.abort(
        'Applicant session is missing or expiring; search run stopped without re-login.',
      );
  }
  // Do not start extra measured searches after the scheduled workload.
  if (
    isApplicant &&
    !config.smoke &&
    Date.now() - exec.scenario.startTime >= config.warmupMs + config.durationMs
  )
    return;
  const criterion =
    config.profile !== 'matrix'
      ? config.queries[
          mixedIndex(exec.scenario.iterationInTest, config.queries.length)
        ]
      : config.queries.find((query) => query.name === config.criterion);
  const epoch = exec.scenario.startTime;
  const offset = Date.now() - epoch;
  const phase = offset < config.warmupMs ? 'warmup' : 'measure';
  const tags = {
    criterion: criterion.name,
    phase,
    epoch: String(epoch),
    name: 'job-search',
  };
  started.add(1, tags);
  const response = http.get(`${config.apiBaseUrl}/api/job?${criterion.query}`, {
    headers: {
      Authorization: `Bearer ${isApplicant ? session.token : __ENV.ACCESS_TOKEN}`,
    },
    timeout: `${config.timeoutMs}ms`,
    redirects: 0,
    tags,
  });
  let payload;
  try {
    payload = response.json();
  } catch {
    payload = null;
  }
  const valid =
    response.status === 200 && validPage(payload, criterion.expected);
  check(
    response,
    { 'HTTP 200 with repository-matching payload': () => valid },
    tags,
  );
  sample.add(response.timings.duration, {
    ...tags,
    status: String(response.status),
    valid: String(valid),
    timeout: String(response.error_code === 1050),
    ended: String(Date.now() - epoch),
  });
  if (phase === 'measure' && valid)
    measuredSample.add(response.timings.duration, tags);
  if (response.status === 401 || response.status === 403) {
    exec.test.abort(
      `HTTP ${response.status}: authentication/permission failed; ${isApplicant ? 'check applicant credentials, active status and permissions' : 'provide a valid ACCESS_TOKEN'}.`,
    );
  }
  if (isApplicant) {
    sleep(
      thinkTimeSeconds(
        exec.vu.idInTest + exec.vu.iterationInScenario,
        config.thinkMinSeconds,
        config.thinkMaxSeconds,
      ),
    );
    sessionEnded.add(Date.now() - epoch, { epoch: String(epoch) });
  }
}
