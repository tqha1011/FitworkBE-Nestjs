# Job Applicant Query Repository Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `IJobApplicantQueryRepo.getJobsAppliedAsync()` from `JobRepository` to `JobApplicantRepository` without changing query behavior or service contracts.

**Architecture:** `JobRepository` owns job aggregate persistence and job queries. `JobApplicantRepository` owns job-application persistence and applicant-facing job-application queries, implementing both `IJobApplicantRepository` and `IJobApplicantQueryRepo`. `JobModule` exposes both interfaces through one `JobApplicantRepository` instance.

**Tech Stack:** NestJS 11, TypeScript, Prisma 7, neverthrow, Jest

**Spec:** User request in this conversation on 2026-09-20.

## Global Constraints

- Preserve `getJobsAppliedAsync(userId, pageNumber, pageSize)` signature.
- Preserve pagination, ordering, score fallback, selected fields, and error messages.
- Do not change `JobService` or `IJobApplicantQueryRepo`.
- Bind `IJobApplicantRepository` and `IJobApplicantQueryRepo` to the same `JobApplicantRepository` instance.
- Move query tests to `job-applicant.repo.spec.ts`; leave job snapshot tests in `job.repo.spec.ts`.
- Do not commit unless the user explicitly requests a commit.

## Review Focus

- DI uses `useExisting`, preventing two `JobApplicantRepository` instances.
- Query keeps `applicantId` ownership filter.
- Pagination keeps deterministic `appliedAt desc, id desc` ordering.
- Missing evaluation keeps `matchingScore: 0`.
- Prisma failures remain `Result.err` with `Failed to get jobs applied`.

---

### Task 1: Pin query behavior to JobApplicantRepository

**Files:**
- Create: `src/modules/job/infrastructure/job-applicant.repo.spec.ts`
- Modify: `src/modules/job/infrastructure/job.repo.spec.ts`

**Interfaces:**
- Consumes: `JobApplicantRepository.getJobsAppliedAsync(userId, pageNumber, pageSize)`
- Produces: repository ownership regression coverage

- [ ] **Step 1: Create failing query tests for JobApplicantRepository**

Create a Prisma mock with `jobApplicant.findMany`, `jobApplicant.count`, and `jobApplicant.create`. Construct `JobApplicantRepository` and move these assertions from `job.repo.spec.ts`:

```ts
const result = await repository.getJobsAppliedAsync(42, 2, 2);

expect(prismaService.jobApplicant.findMany).toHaveBeenCalledWith(
  expect.objectContaining({
    where: { applicantId: 42 },
    take: 2,
    skip: 2,
    orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
  }),
);
expect(result._unsafeUnwrap().items[0]).toEqual(
  expect.objectContaining({
    status: CommonJobApplicantStatus.PENDING,
    matchingScore: 87,
  }),
);
```

Also preserve tests for empty evaluations producing score `0` and Prisma rejection producing `Result.err`.

- [ ] **Step 2: Run new tests and confirm failure**

Run: `npx jest src/modules/job/infrastructure/job-applicant.repo.spec.ts --runInBand`

Expected: FAIL because `JobApplicantRepository` lacks `getJobsAppliedAsync`.

### Task 2: Move query implementation

**Files:**
- Modify: `src/modules/job/infrastructure/job-applicant.repo.ts`
- Modify: `src/modules/job/infrastructure/job.repo.ts`

**Interfaces:**
- Consumes: `IJobApplicantQueryRepo`, `PageResult`, `JobApplicantItemResponseDto`
- Produces: `JobApplicantRepository implements IJobApplicantRepository, IJobApplicantQueryRepo`

- [ ] **Step 1: Add query interface and dependencies to JobApplicantRepository**

Change class declaration to:

```ts
export class JobApplicantRepository
  implements IJobApplicantRepository, IJobApplicantQueryRepo
```

Import `Prisma`, `PageResult`, `JobApplicantItemResponseDto`, and `mapJobApplicantStatusToDomain`.

- [ ] **Step 2: Move getJobsAppliedAsync unchanged**

Move the full method body from `job.repo.ts` into `job-applicant.repo.ts`. Keep:

```ts
async getJobsAppliedAsync(
  userId: number,
  pageNumber: number,
  pageSize: number,
): Promise<Result<PageResult<JobApplicantItemResponseDto>, Error>> {
  try {
    const where: Prisma.JobApplicantWhereInput = { applicantId: userId };
    const [applications, totalItems] = await Promise.all([
      this.prismaService.jobApplicant.findMany({
        where,
        select: {
          status: true,
          proposedRate: true,
          estimatedDay: true,
          appliedAt: true,
          job: { select: { publicId: true } },
          resume: { select: { publicId: true } },
          evaluations: {
            where: { overallScore: { not: null } },
            select: { overallScore: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
        take: pageSize,
        skip: (pageNumber - 1) * pageSize,
      }),
      this.prismaService.jobApplicant.count({ where }),
    ]);

    const items: JobApplicantItemResponseDto[] = applications.map(
      (application) => ({
        jobPublicId: application.job.publicId,
        status: mapJobApplicantStatusToDomain(application.status),
        resumePublicId: application.resume.publicId,
        proposedRate: application.proposedRate.toNumber(),
        estimatedDays: application.estimatedDay,
        appliedAt: application.appliedAt,
        matchingScore: application.evaluations[0]?.overallScore ?? 0,
      }),
    );

    return ok(new PageResult(items, totalItems, pageNumber, pageSize));
  } catch (error) {
    return err(new Error(`Failed to get jobs applied: ${error}`));
  }
}
```

Keep response mapping and error text unchanged.

- [ ] **Step 3: Remove applicant-query ownership from JobRepository**

Change declaration to:

```ts
export class JobRepository implements IJobRepository, IJobQueryRepository
```

Remove `getJobsAppliedAsync` and imports used only by that method: `IJobApplicantQueryRepo`, `JobApplicantItemResponseDto`, `PageResult` only if no job query still needs it, and `mapJobApplicantStatusToDomain`. Retain imports still used by job list/detail queries.

- [ ] **Step 4: Run repository tests**

Run: `npx jest src/modules/job/infrastructure/job-applicant.repo.spec.ts src/modules/job/infrastructure/job.repo.spec.ts --runInBand`

Expected: both suites pass.

### Task 3: Rebind DI and verify application

**Files:**
- Modify: `src/modules/job/job.module.ts`

**Interfaces:**
- Consumes: concrete `JobApplicantRepository`
- Produces: `IJobApplicantRepository` and `IJobApplicantQueryRepo` aliases to one instance

- [ ] **Step 1: Update JobModule providers**

Replace the current query binding to `JobRepository` and `useClass` applicant binding with:

```ts
JobApplicantRepository,
{
  provide: IJobApplicantRepository,
  useExisting: JobApplicantRepository,
},
{
  provide: IJobApplicantQueryRepo,
  useExisting: JobApplicantRepository,
},
```

Keep both interface exports unchanged.

- [ ] **Step 2: Run focused tests**

Run: `npx jest src/modules/job/infrastructure/job-applicant.repo.spec.ts src/modules/job/infrastructure/job.repo.spec.ts src/modules/job/application/services/job.service.spec.ts --runInBand`

Expected: all suites pass.

- [ ] **Step 3: Run full verification**

Run: `npm test -- --runInBand && npm run build && npx eslint src/modules/job && git diff --check`

Expected: all commands exit `0` with no test, type, lint, or whitespace failures.

- [ ] **Step 4: Verify Nest dependency injection**

Run: `npm run start`

Expected: logs include `JobModule dependencies initialized` and no unknown dependency error. Stop the server after `Nest application successfully started`.
