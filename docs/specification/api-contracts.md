# API and realtime contracts

[Documentation index](../README.md) · [Workflows](workflows.md) · [Database schema](database-schema.md)

## Transport and shared conventions

REST routes are explicitly prefixed `/api`; Swagger UI is `/docs`. Protected calls use `Authorization: Bearer <accessToken>`. The JWT `sub` identifies the current user's public ID; clients do not supply an applicant/owner ID to select another user's resources.

Success bodies are returned directly, without a global `{data: ...}` wrapper. Controllers returning `void` produce an empty response body. Dates serialize as ISO 8601 strings. Common roles are `ROLE_COMPANY` and `ROLE_APPLICANT`.

All paginated endpoints return this envelope:

```json
{
  "items": [],
  "totalPages": 0,
  "pageNumber": 1,
  "pageSize": 20,
  "hasPrevious": false,
  "hasNext": false
}
```

There is no `totalItems` response field. `hasPrevious` is calculated from `pageNumber > 1`, including an out-of-range page. Pagination defaults to page `1` and size `20`; both must be positive integers. Resume listing additionally caps size at `100`; job pagination has no configured upper bound.

The global exception filter emits:

```json
{
  "statusCode": 404,
  "timestamp": "2026-10-11T00:00:00.000Z",
  "path": "/api/resume/7867f344-036c-48a1-92f9-296c1385357d",
  "message": "Resume not found"
}
```

The response includes `X-Request-ID`. Error bodies do not expose the internal application `ErrorCode` enum or a DTO validator error array. Typical statuses are `400` for invalid input, `401` for invalid/missing credentials, `403` for denied role/ownership, `404` for missing resources, `409` for incomplete evaluation or concurrent state changes, and `500` for infrastructure failures. The filter uses the HTTP exception's message; exact text depends on the failure path.

Source: [pagination](../../src/shared/common/pagination.ts), [exception filter](../../src/shared/common/exceptions.filter.ts), [DTO validation setup](../../src/main.ts).

## Implemented REST route inventory

“JWT” means authentication only at the controller; resource rules still run in services. “Company” means JWT plus `ROLE_COMPANY`. The latest evaluation route permits both persisted roles but queries the caller's own application.

| Method | Route                                                             | Access                                  | Success    | Purpose                                          |
| ------ | ----------------------------------------------------------------- | --------------------------------------- | ---------- | ------------------------------------------------ |
| POST   | `/api/auth/register`                                              | No access JWT required                  | 201        | Create account                                   |
| POST   | `/api/auth/login`                                                 | No access JWT required                  | 200        | Issue access token and refresh cookie            |
| POST   | `/api/auth/refresh`                                               | Refresh cookie                          | 200        | Rotate refresh credential                        |
| POST   | `/api/auth/logout`                                                | Optional refresh cookie                 | 204        | Revoke supplied refresh credential; clear cookie |
| POST   | `/api/job`                                                        | Company                                 | 201, empty | Create job                                       |
| GET    | `/api/job`                                                        | JWT                                     | 200        | Search open jobs                                 |
| GET    | `/api/job/applied`                                                | JWT                                     | 200        | Current user's applications                      |
| PATCH  | `/api/job/:jobPublicId`                                           | JWT + job ownership                     | 200, empty | Update job                                       |
| POST   | `/api/job/:jobPublicId/apply`                                     | JWT + resume ownership                  | 201        | Submit application                               |
| PATCH  | `/api/job/applicants/:jobApplicantPublicId/status`                | Company + job ownership                 | 200        | Hiring decision                                  |
| GET    | `/api/skills`                                                     | JWT                                     | 200        | Skill references                                 |
| GET    | `/api/categories`                                                 | JWT                                     | 200        | Category references                              |
| GET    | `/api/arrangements`                                               | JWT                                     | 200        | Arrangement references                           |
| POST   | `/api/resume/upload-url`                                          | JWT                                     | 201        | Signed PUT URL                                   |
| POST   | `/api/resume`                                                     | JWT + uploaded object ownership         | 201        | Register file and queue ingestion                |
| GET    | `/api/resume`                                                     | JWT; owned active rows only             | 200        | List resume metadata                             |
| GET    | `/api/resume/:resumePublicId`                                     | JWT; owned active row only              | 200        | Resume metadata detail                           |
| PATCH  | `/api/resume/:resumePublicId`                                     | JWT + resume ownership                  | 200        | Replace file and ingestion version               |
| DELETE | `/api/resume/:resumePublicId`                                     | JWT + resume ownership                  | 204        | Soft-delete resume                               |
| GET    | `/api/resume/:resumePublicId/download-url`                        | JWT + resume ownership                  | 200        | Signed download/preview URL                      |
| POST   | `/api/applicant-evaluation`                                       | JWT + matching owned application/resume | 201        | Queue or reuse evaluation                        |
| GET    | `/api/applicant-evaluation/:jobPublicId`                          | Applicant or company; own application   | 200        | Latest evaluation result for the job             |
| GET    | `/api/applicant-evaluation/jobs/:jobPublicId/:evaluationPublicId` | Company + job ownership                 | 200        | Explicit evaluation with review metadata         |

There are **23 REST handlers**. No user/profile CRUD, job-detail GET, company application-list GET, or dedicated health route is currently exposed. A response DTO or repository method alone does not establish a public route.

## Authentication

| Endpoint | Request                                                 | Response                                                      |
| -------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| Register | `email`, `username`, `fullName`, `password`, `userType` | `{publicId: string}`                                          |
| Login    | `email`, `password`                                     | `{accessToken: string, expiresIn: number}` and refresh cookie |
| Refresh  | No body; `refresh_token` cookie                         | Same token response and rotated cookie                        |
| Logout   | No body; cookie if supplied                             | No body                                                       |

Registration requires a valid email, username length at least `3`, nonempty full name, and password length at least `8` with the `IsStrongPassword` default complexity rules. `userType` is `APPLICANT` or `COMPANY`. Login requires a valid email and string password. `expiresIn` is seconds.

The refresh cookie is named `refresh_token`, HTTP-only, SameSite `lax`, secure when `NODE_ENV=production`, and scoped to `/api/auth/refresh`. Browser clients need credentials enabled for cookie-based login/refresh. The current cookie path excludes logout; see the [session workflow](workflows.md#registration-and-sessions) for the resulting revocation behavior. Access tokens are not revoked by logout.

Sources: [auth controller](../../src/modules/auth/api/auth.controller.ts), [request DTOs](../../src/modules/auth/application/dtos/auth.request.dto.ts).

## Jobs, applications, and reference data

### Create and update a job

`POST /api/job` requires all fields below, even where Swagger DTO properties are marked optional:

```json
{
  "title": "Backend developer",
  "description": "Build a recruitment API",
  "requirements": "NestJS and PostgreSQL experience",
  "location": "Ho Chi Minh City",
  "status": "OPEN",
  "dueAt": "2027-01-01T00:00:00.000Z",
  "budget": 1000,
  "currency": "USD",
  "categoryId": 1,
  "arrangementId": 1,
  "skillsId": [1, 2]
}
```

The service verifies reference IDs, deduplicates skills, checks a nonnegative budget and valid due date, and calculates the VND-normalized budget. Currency is `VND` or `USD`; status is `OPEN` or `CLOSED`. Creation returns no job ID/body.

`PATCH /api/job/:jobPublicId` accepts optional `title`, `description`, `requirements`, `location`, `status`, `dueAt`, and `budget`. It verifies actual job ownership. Currency, category, arrangement, and attached skills are not editable through this DTO. Budget updates use the job's existing currency.

### Search and application history

`GET /api/job` accepts `pageNumber`, `pageSize`, optional `title`, comma-separated `categoryIds`, comma-separated `skillIds`, `budgetMin`, and `budgetMax`. Title is an insensitive substring; skill filtering matches **any** selected skill. Budget bounds are VND values, nonnegative, with max at least min when both supplied.

Only `OPEN` jobs are selected; `dueAt` is not an additional search predicate. Ordering is `createdAt DESC, dueAt DESC`. Each item contains:

```text
publicId, title, description, location, budget, currency,
skills: [{id, name}], category: {id, name}, arrangement: {id, name},
dueAt, totalApplicants
```

`budget` remains in original currency. `totalApplicants` counts pending and accepted applications. Search requires JWT despite “public search” wording in the overview README.

`GET /api/job/applied` uses shared pagination and the caller's JWT identity. Items contain `jobApplicantPublicId`, `jobPublicId`, `status`, `resumePublicId`, `proposedRate`, `estimatedDays`, `appliedAt`, and `matchingScore`. Note the plural response `estimatedDays` versus request `estimatedDay`. `matchingScore` uses the newest non-null score or `0`.

### Submit and decide an application

`POST /api/job/:jobPublicId/apply` body:

```json
{
  "resumePublicId": "7867f344-036c-48a1-92f9-296c1385357d",
  "coverLetter": "I have relevant backend experience.",
  "proposedRate": 1000,
  "estimatedDay": 10
}
```

`proposedRate` must be a number ≥ `0`; `estimatedDay` a number ≥ `1` (DTO does not require an integer, although persistence uses Int). Send whole days. Resume must be owned and active. The service does not currently enforce applicant role, open job/deadline, or completed ingestion on this endpoint. Success is `{message: "Applied successfully"}`. One application per applicant/job is enforced by the database; a duplicate currently maps to `500`.

`PATCH /api/job/applicants/:jobApplicantPublicId/status` accepts `{status: "ACCEPTED"}` or another application enum member. Only `PENDING → ACCEPTED`, `PENDING → REJECTED`, and `ACCEPTED → COMPLETED` are allowed. Repeated/invalid transitions return `400`; a concurrent stale update returns `409`. Accepting also rejects competing pending applications transactionally. Success is `{message: "Job applicant status updated successfully"}`.

`GET /api/skills`, `/api/categories`, and `/api/arrangements` each return an array of `{id: number, name: string}`. Use these integer IDs in job creation and filters. Reference results are cached for one hour.

Sources: [job controller](../../src/modules/job/api/job.controller.ts), [job request DTOs](../../src/modules/job/application/dtos/job.request.dto.ts), [job response DTOs](../../src/modules/job/application/dtos/job.response.dto.ts).

## Resumes

### Upload, register, replace, delete

| Operation     | Request                                                     | Response                                                       |
| ------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| Signed upload | `{fileName: string, contentType: string, fileSize: number}` | `{uploadUrl: string, storageKey: string, expiresAt: ISO date}` |
| Register      | `{name: string, storageKey: string}`                        | `{publicId, ingestionPublicId, ingestionStatus}`               |
| Replace       | Same required fields as register                            | Same response shape                                            |
| Delete        | Resume ID in path                                           | Empty 204                                                      |

Accepted MIME types are `application/pdf` and `application/vnd.openxmlformats-officedocument.wordprocessingml.document`. Upload URL validity is 300 seconds. PUT the bytes directly to storage with the signed content type and declared length, then register the returned storage key. Registration/replacement verify actual object metadata and enforce the 5 MiB maximum. Requesting a signed URL does not mean ingestion or persistence has happened.

Resume replacement changes the current file metadata and queues/reuses its content version. Deletion is soft. Ownership violations on mutation and download routes return `403`, while missing resumes return `404`.

### Read owned active metadata

`GET /api/resume?pageNumber=1&pageSize=20` returns `PageResult<ResumeReadResponseDto>`, sorted `createdAt DESC, id DESC`, with size limited to `1..100`. An empty or out-of-range page returns `200` and empty items.

`GET /api/resume/:resumePublicId` returns the same item shape:

```json
{
  "publicId": "7867f344-036c-48a1-92f9-296c1385357d",
  "fileName": "Backend CV",
  "fileType": "pdf",
  "fileSize": 204800,
  "createdAt": "2026-10-01T00:00:00.000Z",
  "updatedAt": "2026-10-02T00:00:00.000Z",
  "ingestionPublicId": null,
  "ingestionStatus": null
}
```

`fileType` is lowercase `pdf` or `docx`; size is bytes. Ingestion describes the current uploaded file, with status `PENDING`, `PROCESSING`, `COMPLETED`, or `FAILED`. Both ingestion fields are null if no content version matches that file. Incomplete/failed ingestion still returns metadata with `200`. The response omits internal IDs, storage keys, extracted text, and ingestion errors.

Owner selection always comes from JWT. Detail returns `404` for a foreign, deleted, or absent resume; malformed detail UUID and invalid pagination return `400`.

### Preview and download

`GET /api/resume/:resumePublicId/download-url?disposition=inline` returns `{downloadUrl: string}` for preview. `disposition` defaults to `attachment` for download; other values return `400`. Signed GET URLs last 900 seconds. This endpoint returns a URL rather than file bytes; the client retrieves the file from storage.

Sources: [resume controller](../../src/modules/resume/api/resume.controller.ts), [request DTOs](../../src/modules/resume/application/dtos/resume.request.dto.ts), [response DTOs](../../src/modules/resume/application/dtos/resume.response.dto.ts).

## Applicant evaluation

### Queue or reuse

`POST /api/applicant-evaluation` takes UUID strings `{jobPublicId, resumePublicId}` and returns `{publicId: evaluationPublicId}` with `201`, including when reusing an existing evaluation.

The caller must have the matching application and owned parsed resume. Missing job/application returns `404`; unavailable/invalid resume content or unfinished ingestion returns `400`; preparation, configuration, or enqueue failure returns `500`. Reuse and V1/V2 selection are described in [workflows](workflows.md#evaluation-preparation-and-reuse).

### Latest caller result by job

`GET /api/applicant-evaluation/:jobPublicId` takes a **job public ID**, not an evaluation ID. Both persisted roles pass the role guard, but the query selects only the caller's application using JWT `sub`. There is no applicant ID query/body field. Newest evaluation means `createdAt DESC, id DESC`.

Result readiness checks `overallScore`, `scoreBreakdown`, and `evidence` for non-null values. Missing job/application/evaluation returns `404`; any missing result field returns `409`, including a newest pending, processing, or failed result. It does not return an older completed evaluation in that case.

The completed response is `{publicId, overallScore, scoreBreakdown, evidence}`. The public ID identifies the evaluation. V1 example:

```json
{
  "publicId": "96547ff4-111b-4f43-92af-4b052a254f5f",
  "overallScore": 80,
  "scoreBreakdown": {
    "schemaVersion": 1,
    "skills": 85,
    "experience": 80,
    "education": 70,
    "overallFit": 80
  },
  "evidence": {
    "schemaVersion": 1,
    "strengths": ["Relevant backend experience"],
    "gaps": ["Limited project evidence"],
    "explanation": "The resume meets several stated requirements."
  }
}
```

V2 `scoreBreakdown` is `{schemaVersion: 2, criteria: [{criterionId, scoreContribution}]}`. V2 evidence is `{schemaVersion: 2, criteria: [...], strengths, gaps, explanation}`. Each evidence criterion has `criterionId`, `criterionText`, `verdict` (`MATCHED`, `PARTIAL`, `MISSING`), `scoreContribution`, `explanation`, and `evidence` references. A reference contains `snippet`, `section: "resume"`, `startOffset`, and `endOffset` against the stored redacted text. Frontends must branch on `schemaVersion` rather than assume V1 category scores.

### Company owner review

`GET /api/applicant-evaluation/jobs/:jobPublicId/:evaluationPublicId` requires company role and actual job ownership. Association of the evaluation with that job is checked. Authorization runs before reading the owner-specific cache. Unauthorized owner/job selection returns `403`; absent associated evaluation `404`; incomplete result `409`.

The response extends the common result with:

```text
decisionSupportOnly: true
resumeRedaction: {redactedResumeText: string|null, redactedResumeVersion: string|null}
metadata: {
  jobContentHash, resumeContentHash, redactedResumeHash: string|null,
  parserVersion, redactionVersion: string|null, model, promptVersion
}
```

This route uses an explicit evaluation ID and can inspect a historical result. There is no current company endpoint listing all job applicants/evaluation IDs.

Sources: [evaluation controller](../../src/modules/applicant-evaluation/api/applicant-evaluation.controller.ts), [response types](../../src/modules/applicant-evaluation/application/dtos/applicant-evaluation.response.dto.ts), [versioned result types](../../src/modules/applicant-evaluation/domain/value-objects/evaluation.ts).

## Socket.IO contracts

Connect to namespace `/resume` or `/evaluation` with `auth: {token: accessToken}`. The token is raw JWT, without `Bearer `. Invalid credentials disconnect the socket. JWT verification occurs on connection. Both gateways allow the configured localhost frontend origins with credentials.

| Namespace     | Client event      | Payload                      | Server response event/data                                        |
| ------------- | ----------------- | ---------------------------- | ----------------------------------------------------------------- |
| `/resume`     | `resume-join`     | `{resumePublicId: UUID}`     | `resume-join`: `{joined: boolean, current?: ResumeState}`         |
| `/resume`     | `resume-leave`    | `{resumePublicId: UUID}`     | `resume-leave`: `{left: boolean}`                                 |
| `/evaluation` | `evaluation-join` | `{evaluationPublicId: UUID}` | `evaluation-join`: `{joined: boolean, current?: EvaluationState}` |

Responses use Nest `WsResponse` event emission; clients listen for the named response event. They are not documented as Socket.IO callback acknowledgements. Ownership is checked before joining. Evaluation subscription is for the application's applicant; company ownership alone does not grant that room subscription. Unauthorized/unavailable join returns `joined: false`. A resume join may succeed without `current` if no current content exists. There is no evaluation-leave handler.

| Notification                               | Data                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `ingestion-process-notify` on `/resume`    | `{resumePublicId, ingestionPublicId, status, errorMessage?, updatedAt}` |
| `evaluation-score-notify` on `/evaluation` | `{evaluationPublicId, status, overallScore?, errorMessage?, updatedAt}` |

The same data shapes form `ResumeState` and `EvaluationState` in join responses. `updatedAt` is ISO text; status is `PENDING`, `PROCESSING`, `COMPLETED`, or `FAILED`. A score of zero is valid and can be present. Notifications carry processing state; use REST to retrieve full results. Rejoin after reconnecting to obtain current database state.

Rooms are named `resume/<resumePublicId>` and `evaluation/<evaluationPublicId>`. Publication is best effort and local to the worker/application process. The implementation does not configure a Redis Socket.IO adapter or durable notification replay.

Sources: [resume gateway](../../src/modules/realtime/gateways/resume-gateway.ts), [evaluation gateway](../../src/modules/realtime/gateways/applicant-evaluation-gateway.ts), [event names](../../src/modules/realtime/constants/event-name.ts).
