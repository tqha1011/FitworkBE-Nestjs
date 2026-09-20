# Secure Job Applicant Status Transition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make job-applicant status changes authorized, rule-driven, race-safe, and fully tested.

**Architecture:** A domain transition function owns the allowed state matrix. `JobApplicantService` identifies the current actor and verifies job ownership from a compact repository context. `JobApplicantRepository` performs a compare-and-set update with the expected old status, preventing concurrent requests from overwriting newer state.

**Tech Stack:** NestJS 11, TypeScript, Prisma 7, neverthrow, Jest

**Spec:** Findings from the code review in this conversation on 2026-09-20.

## Global Constraints

- Company job owner is the only actor allowed to change application status.
- Allowed transitions are `PENDING -> ACCEPTED`, `PENDING -> REJECTED`, and `ACCEPTED -> COMPLETED`.
- `REJECTED` and `COMPLETED` are terminal.
- Same-status requests return `BadRequest`.
- A concurrent status change returns `Conflict`, not `InternalServerError`.
- Service accepts only actor public ID, job-applicant public ID, and next status.
- Existing apply-job and applied-jobs behavior must remain unchanged.
- Expose the transition through a JWT-protected controller endpoint.
- Require `ROLE_COMPANY` through `RolesGuard`; service ownership validation
  remains mandatory.
- Do not commit unless the user explicitly requests a commit.

## Review Focus

- Non-owner cannot transition an application.
- Runtime-invalid status cannot bypass transition validation.
- Two requests using the same expected status cannot both succeed.
- Missing actor or application maps to `NotFound`.
- Prisma failures remain `InternalServerError`; stale compare-and-set maps to `Conflict`.

---

### Task 1: Domain transition matrix

**Files:**

- Create: `src/modules/job/domain/value-objects/job-applicant-status-transition.ts`
- Create: `src/modules/job/domain/value-objects/job-applicant-status-transition.spec.ts`

**Interfaces:**

- Produces: `canTransitionJobApplicantStatus(currentStatus, nextStatus): boolean`
- Consumes: `CommonJobApplicantStatus`

- [ ] **Step 1: Write transition matrix tests**

```ts
it.each([
  [CommonJobApplicantStatus.PENDING, CommonJobApplicantStatus.ACCEPTED],
  [CommonJobApplicantStatus.PENDING, CommonJobApplicantStatus.REJECTED],
  [CommonJobApplicantStatus.ACCEPTED, CommonJobApplicantStatus.COMPLETED],
])('allows %s to %s', (currentStatus, nextStatus) => {
  expect(canTransitionJobApplicantStatus(currentStatus, nextStatus)).toBe(true);
});

it.each([
  [CommonJobApplicantStatus.PENDING, CommonJobApplicantStatus.COMPLETED],
  [CommonJobApplicantStatus.ACCEPTED, CommonJobApplicantStatus.PENDING],
  [CommonJobApplicantStatus.REJECTED, CommonJobApplicantStatus.ACCEPTED],
  [CommonJobApplicantStatus.COMPLETED, CommonJobApplicantStatus.REJECTED],
])('rejects %s to %s', (currentStatus, nextStatus) => {
  expect(canTransitionJobApplicantStatus(currentStatus, nextStatus)).toBe(
    false,
  );
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npx jest src/modules/job/domain/value-objects/job-applicant-status-transition.spec.ts --runInBand`

Expected: FAIL because transition function does not exist.

- [ ] **Step 3: Implement explicit matrix**

```ts
const allowedTransitions: Record<
  CommonJobApplicantStatus,
  readonly CommonJobApplicantStatus[]
> = {
  [CommonJobApplicantStatus.PENDING]: [
    CommonJobApplicantStatus.ACCEPTED,
    CommonJobApplicantStatus.REJECTED,
  ],
  [CommonJobApplicantStatus.ACCEPTED]: [CommonJobApplicantStatus.COMPLETED],
  [CommonJobApplicantStatus.REJECTED]: [],
  [CommonJobApplicantStatus.COMPLETED]: [],
};

export function canTransitionJobApplicantStatus(
  currentStatus: CommonJobApplicantStatus,
  nextStatus: CommonJobApplicantStatus,
): boolean {
  return allowedTransitions[currentStatus]?.includes(nextStatus) ?? false;
}
```

- [ ] **Step 4: Run matrix tests**

Run: `npx jest src/modules/job/domain/value-objects/job-applicant-status-transition.spec.ts --runInBand`

Expected: PASS.

### Task 2: Atomic repository contract

**Files:**

- Modify: `src/modules/job/domain/repositories/job-applicant.repo.interface.ts`
- Modify: `src/modules/job/infrastructure/job-applicant.repo.ts`
- Modify: `src/modules/job/infrastructure/job-applicant.repo.spec.ts`

**Interfaces:**

- Produces: `JobApplicantStatusContext`, `getStatusContext()`, `transitionStatus()`
- Consumes: Prisma job-applicant model and status mapper

- [ ] **Step 1: Replace check/update contracts**

```ts
export type JobApplicantStatusContext = {
  jobId: number;
  jobOwnerId: number;
  status: CommonJobApplicantStatus;
};

abstract getStatusContext(
  jobApplicantPublicId: string,
): Promise<Result<JobApplicantStatusContext | null, Error>>;

abstract transitionStatus(
  jobApplicantPublicId: string,
  jobId: number,
  expectedStatus: CommonJobApplicantStatus,
  nextStatus: CommonJobApplicantStatus,
): Promise<Result<boolean, Error>>;
```

- [ ] **Step 2: Write failing repository tests**

Test context mapping:

```ts
prismaService.jobApplicant.findUnique.mockResolvedValue({
  jobId: 10,
  status: JobApplicantStatus.PENDING,
  job: { postedBy: 20 },
});

expect(
  (await repository.getStatusContext('application-id'))._unsafeUnwrap(),
).toEqual({
  jobId: 10,
  jobOwnerId: 20,
  status: CommonJobApplicantStatus.PENDING,
});
```

Test atomic update:

```ts
prismaService.jobApplicant.updateMany.mockResolvedValue({ count: 1 });

expect(
  await repository.transitionStatus(
    'application-id',
    10,
    CommonJobApplicantStatus.PENDING,
    CommonJobApplicantStatus.ACCEPTED,
  ),
).toEqual(ok(true));

expect(prismaService.jobApplicant.updateMany).toHaveBeenCalledWith({
  where: {
    publicId: 'application-id',
    jobId: 10,
    status: JobApplicantStatus.PENDING,
  },
  data: { status: JobApplicantStatus.ACCEPTED },
});
```

Also test missing context, `count: 0`, and Prisma failures.

- [ ] **Step 3: Run repository tests and confirm failure**

Run: `npx jest src/modules/job/infrastructure/job-applicant.repo.spec.ts --runInBand`

Expected: FAIL because new repository methods do not exist.

- [ ] **Step 4: Implement context query and compare-and-set update**

Use `findUnique` by public ID with `jobId`, `status`, and `job.postedBy`. Use `updateMany` filtered by public ID, job ID, and expected status. Return `ok(updated.count === 1)`.

- [ ] **Step 5: Run repository tests**

Run: `npx jest src/modules/job/infrastructure/job-applicant.repo.spec.ts --runInBand`

Expected: PASS.

### Task 3: Authorized application service

**Files:**

- Modify: `src/modules/job/application/interfaces/job-applicant.service.interface.ts`
- Modify: `src/modules/job/application/services/job-applicant.service.ts`
- Create: `src/modules/job/application/services/job-applicant.service.spec.ts`

**Interfaces:**

- Consumes: `IUserRepository.resolvePublicIdToId`, repository status context, domain transition matrix
- Produces: `confirmJobApplicantAsync(actorPublicId, jobApplicantPublicId, nextStatus)`

- [ ] **Step 1: Change service signature**

```ts
abstract confirmJobApplicantAsync(
  actorPublicId: string,
  jobApplicantPublicId: string,
  nextStatus: CommonJobApplicantStatus,
): Promise<Result<undefined, AppError>>;
```

- [ ] **Step 2: Write failing service tests**

Cover:

```ts
it('allows the job owner to transition pending to accepted', async () => {
  userRepository.resolvePublicIdToId.mockResolvedValue(ok(20));
  jobApplicantRepository.getStatusContext.mockResolvedValue(
    ok({
      jobId: 10,
      jobOwnerId: 20,
      status: CommonJobApplicantStatus.PENDING,
    }),
  );
  jobApplicantRepository.transitionStatus.mockResolvedValue(ok(true));

  const result = await service.confirmJobApplicantAsync(
    'company-id',
    'application-id',
    CommonJobApplicantStatus.ACCEPTED,
  );

  expect(result.isOk()).toBe(true);
});
```

Also test user lookup failure, missing user, missing application, wrong owner, same status, forbidden transition, repository errors, and stale `transitionStatus` returning `false`.

- [ ] **Step 3: Run service tests and confirm failure**

Run: `npx jest src/modules/job/application/services/job-applicant.service.spec.ts --runInBand`

Expected: FAIL against the current four-argument service and non-atomic repository API.

- [ ] **Step 4: Implement authorized transition flow**

Resolve actor ID and application context concurrently. Return `NotFound` for missing actor/application, `Forbidden` for owner mismatch, `BadRequest` for same or forbidden transition, and `Conflict` when compare-and-set returns `false`. Keep repository failures mapped to `InternalServerError`.

- [ ] **Step 5: Remove old validation function and unused lookups**

Delete `checkValidStatusJobApplicant`, `checkExistingJobApplicant`, and `confirmJobApplicant`. Keep job and resume repositories in the service constructor because `applyJobAsync` still uses them.

- [ ] **Step 6: Run service tests**

Run: `npx jest src/modules/job/application/services/job-applicant.service.spec.ts --runInBand`

Expected: PASS.

### Task 4: Full verification

**Files:**

- Verify all changed job-applicant files

**Interfaces:**

- Consumes: all prior task outputs
- Produces: verified authorized and atomic transition flow

- [ ] **Step 1: Run focused tests**

Run: `npx jest src/modules/job/domain/value-objects/job-applicant-status-transition.spec.ts src/modules/job/infrastructure/job-applicant.repo.spec.ts src/modules/job/application/services/job-applicant.service.spec.ts --runInBand`

Expected: all suites pass.

- [ ] **Step 2: Run full static and unit verification**

Run: `npm test -- --runInBand && npm run build && npx eslint src/modules/job && git diff --check`

Expected: all commands exit `0`.

- [ ] **Step 3: Verify Nest dependency injection**

Run: `npm run start`

Expected: `JobModule dependencies initialized` and `Nest application successfully started` without unknown dependency errors. Stop server after startup.
