# FitWork Demo — backend contract for the FE agent

Backend changes are on the current branch `feat/monitoring-evaluation`. Frontend implementation is separate. All JSON responses below are direct objects (no `data` wrapper). Use the existing API client, Authorization bearer token, and `withCredentials: true`. Production frontend, `/api`, and Socket.IO must share one HTTPS origin.

## 1. Start and restore a demo

`POST /api/auth/demo` — public, HTTP **201**.

```json
{ "userType": "COMPANY" }
```

`userType` accepts `COMPANY` or `APPLICANT`; omitted defaults to `COMPANY`. No credentials are returned.

```json
{ "accessToken": "<JWT>", "expiresIn": 900 }
```

The server also sets `refresh_token`: HttpOnly, Secure in production, SameSite=Lax, Path=/api/auth/refresh. Access token lifetime is capped by the session deadline. JWT includes the existing `sub`, `email`, `role` (`ROLE_COMPANY` / `ROLE_APPLICANT`) plus `demoSessionId`, `demoExpiresAt` (epoch milliseconds), `demoGeneration`.

`POST /api/auth/refresh` — existing endpoint, HTTP **200**, no body; send cookies. Returns the same token shape and rotates the cookie. On reload call refresh once, derive role from the new JWT, then fetch the session. A revoked, expired, obsolete-role, or replayed demo cookie returns **401** and never creates a new workspace.

`POST /api/auth/logout` — existing endpoint, HTTP **204**. **Keep and send the current Authorization bearer token**: the refresh cookie is scoped to `/api/auth/refresh` and is normally absent on logout. Logout revokes the whole workspace and both primary accounts' refresh tokens, disconnects sockets, and clears the cookie. Clear FE state after the request. A stale bearer returns 401 (cookie still cleared).

## 2. Read the workspace

`GET /api/demo/session` — bearer required, HTTP **200**.

```ts
type DemoSession = {
  id: string;
  expiresAt: string; // ISO 8601; session deadline, not access-token expiry
  userType: "COMPANY" | "APPLICANT";
  generation: number;
  ai: {
    used: number; limit: number; remaining: number;
    available: boolean; unavailableReason: string | null;
  };
  uploads: { used: number; limit: number; remaining: number; maxFileBytes: number };
  jobs: { publicId: string; title: string; isFeatured: boolean }[];
  resumes: { publicId: string; fileName: string; isPrimaryApplicant: boolean }[];
  applications: {
    publicId: string; // jobApplicantPublicId for decisions
    jobPublicId: string;
    resumePublicId: string;
    applicantName: string;
    isPrimaryApplicant: boolean;
    status: "PENDING" | "ACCEPTED" | "REJECTED" | "COMPLETED";
    sampleEvaluationPublicId: string | null;
    latestEvaluationPublicId: string | null;
    evaluations: {
      publicId: string; source: "SAMPLE" | "LIVE";
      status: "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
      overallScore: number | null;
    }[];
  }[];
};
```

Initially: 3 open jobs; 3 parsed CVs; 3 applications to the featured backend job; completed V2 samples with scores 100/33/0. The applicant role receives only its own applications/CVs; the recruiter receives all workspace applications. The main applicant is `isPrimaryApplicant=true` and may apply to the other two jobs. Re-fetch session after an apply, AI request/update, decision, or role switch. `ai.remaining` is the minimum of session, daily global, and daily IP budgets; `ai.available=false` when configuration or quota prevents live AI. Samples remain available.

## 3. Switch roles without racing refresh

`POST /api/auth/demo/switch` — bearer required, HTTP **200**.

```json
{ "userType": "APPLICANT" }
```

Response is `{accessToken, expiresIn}` plus a rotated refresh cookie. Workspace ID and data persist; JWT generation increments. Old access tokens, old refresh cookies, and old sockets become invalid.

FE sequence: wait for any in-flight refresh → block new refresh starts → increment FE session generation and cancel old requests/disconnect sockets → POST switch using the current token → install returned token → reload providers/session/jobs/applications → reconnect sockets using the new token. Ignore responses or refresh results from older FE generations. On failure retain a recoverable state; never restore an old token after a successful switch.

## 4. Existing job/resume/evaluation APIs

`GET /api/job?pageNumber=1&pageSize=20` keeps existing filters (`title`, `categoryIds`, `skillIds`, `budgetMin`, `budgetMax`). It now scopes both rows and pagination count to the demo workspace. Existing pagination shape is `{items,totalPages,pageNumber,pageSize,hasPrevious,hasNext}` — there is no `totalItems` field.

`POST /api/job/:jobPublicId/apply` — applicant role; HTTP **201**:

```json
{ "resumePublicId": "<UUID>", "coverLetter": "I would like to contribute to your team.", "proposedRate": 15000000, "estimatedDay": 30 }
```

Returns `{ "message": "Applied successfully" }`. Applications persist across role switches. Existing duplicate-application and job-status validation still applies.

`GET /api/job/applied` — existing applicant applications list.

`POST /api/applicant-evaluation` — applicant role, HTTP **201**:

```json
{ "jobPublicId": "<UUID>", "resumePublicId": "<UUID>" }
```

Returns `{ "publicId": "<evaluation UUID>" }` when queued or reused. Apply first. A sample uses its own model identity, so a live request creates a separate evaluation. Repeated pending/processing/completed live input reuses the ID and does not consume another quota slot; failed evaluation retry consumes another slot. **429** means quota exhausted, **503** means live AI is not configured; both should leave sample-view controls available. A later provider failure appears as FAILED through realtime/session.

Applicant read: `GET /api/applicant-evaluation/:jobPublicId?evaluationPublicId=<UUID>` — optional query is **new**. Without it, latest evaluation behavior is unchanged. To reopen a sample during a live run/failure, always pass `sampleEvaluationPublicId`. Ownership is checked. HTTP 200 returns `{publicId,source,overallScore,scoreBreakdown,evidence}`. Incomplete selected/latest evaluation returns **409**.

Recruiter read: `GET /api/applicant-evaluation/jobs/:jobPublicId/:evaluationPublicId` — HTTP **200**, existing V1/V2 detail plus `source: "SAMPLE" | "LIVE"`. Contains `decisionSupportOnly`, redacted CV and metadata. Use workspace application evaluation IDs. Display **Sample result** / **Live AI result** labels from `source`.

CV preview/download: `GET /api/resume/:resumePublicId/download-url?disposition=inline` (or `attachment`) → `{downloadUrl}`. Works for the applicant's CV and, in demo, the recruiter's own applicants' CVs. URLs expire at or before the session deadline (max 15 min); an already issued URL is a bearer URL and cannot be immediately revoked on logout. Shared sample PDFs are immutable and are retained by cleanup.

Upload: `POST /api/resume/upload-url` → `{uploadUrl,storageKey,expiresAt}`; body `{fileName,contentType,fileSize}`; accepted existing PDF/DOCX MIME types. Limit 3 URLs/session, each ≤5 MiB. Then PUT the file to `uploadUrl` and `POST /api/resume` with `{name,storageKey}` as before. Generated keys use `user/<userPublicId>/<UUID>/cv.pdf` (or docx); abandoned keys are tracked for cleanup.

Recruiter decisions: `PATCH /api/job/applicants/:jobApplicantPublicId/status`, body `{ "status": "ACCEPTED" }` / `REJECTED` / `COMPLETED` → HTTP **200**, `{message}`. COMPLETE only after ACCEPTED; existing transition validation applies. Use `applications[].publicId`.

## 5. Realtime and expiration

Existing Socket.IO namespaces `/evaluation` and `/resume`, path `/socket.io`, handshake `auth: {token: accessToken}`. Evaluation events: emit `evaluation-join` with `{evaluationPublicId}`, listen for `evaluation-join` (`{joined,current?}`) and `evaluation-score-notify`. Resume events: `resume-join`, `resume-leave`, `ingestion-process-notify` remain unchanged. Only the applicant owner may join evaluation/CV processing rooms; the recruiter reads results through HTTP/session. Switch/logout disconnect immediately on the same API instance; other instances detect revocation within 5 seconds. Session/access-token expiration disconnects at the token deadline. Reconnect with a refreshed token where the demo session is still valid.

Before the session deadline, a protected-request 401 can use the existing **single refresh then single retry** flow: access tokens expire earlier than the 60-minute workspace. If refresh returns **401**, or when `expiresAt` passes, stop refresh loops, cancel sockets/requests and show **“Demo expired — Start new demo”**. Ignore stale-generation request failures during a role switch. Starting a new demo requires an explicit click; never auto-create. On 429 show the reason and keep sample results accessible. Demo APIs return 404 when `DEMO_ENABLED=false`; regular login/register return 404 in the isolated demo environment. Cross-workspace resource UUIDs return 404.

Default limits: 60-minute workspace, 3 live AI requests/session, 30/day across the environment, 6/day/IP, 3 new sessions/IP/rolling hour, 20 active sessions, 60 requests/min/session, 3 upload URLs. AI CV input max 16,000 redacted characters; output max 4,096 tokens. Session/quota state is in PostgreSQL, not reset by Redis or a new session.

FE acceptance route: `/demo` → start COMPANY → list demo applicants and read a sample/PDF → switch APPLICANT → apply to another job/run live AI → return COMPANY → inspect LIVE/sample and ACCEPT/REJECT/COMPLETE → expiration screen → explicit new demo. Add “Try demo” to sign-in and a banner with role switch, countdown and remaining AI quota.

Backend deployment requires migrations and uploading the three checked-in sample PDFs into the dedicated demo bucket; see `docs/demo/operations.md`. The dedicated stack sets `DEMO_ONLY=true` to keep ordinary auth closed even if `DEMO_ENABLED` is disabled. Actual Gemini credentials and public HTTPS hosting are deployment inputs, not included in this change.
