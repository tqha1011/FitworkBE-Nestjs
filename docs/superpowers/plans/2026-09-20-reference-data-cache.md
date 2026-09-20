# Reference Data Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one-hour Redis read-through caching to category, arrangement, and skill list services.

**Architecture:** Application services depend only on `IApplicationCache`. Each service uses a versioned cache key, treats `undefined` as a miss, falls back to its repository when cache reads fail, and keeps successful repository responses when cache writes fail. Skill receives the same service/controller structure already used by category and arrangement.

**Tech Stack:** NestJS 11, TypeScript, neverthrow, cache-manager 7, Keyv Redis, Jest

**Spec:** User request in this conversation on 2026-09-20.

## Global Constraints

- Cache TTL is exactly `3_600_000` milliseconds (one hour).
- Cache failures must never make reference-data endpoints fail.
- Repository failures must remain `AppError(ErrorCode.InternalServerError, ...)`.
- Cache keys must be versioned and unique per reference-data type.
- Empty arrays are valid cached values; only `undefined` is a cache miss.
- Application services must not import Nest cache-manager or Redis packages.
- Do not add cache invalidation because no category, arrangement, or skill mutation endpoint exists.
- Do not commit unless the user explicitly requests a commit.

## Review Focus

- Cache contains an empty array: return it without querying the repository.
- Redis read fails: query the repository and return its result.
- Redis write fails: return repository data without an application error.
- Repository read fails after a cache miss: preserve current internal-error behavior.
- Skill endpoint wiring is complete: controller, interface, service, module provider, and module controller registration.

---

### Task 1: Reference-data cache constants

**Files:**
- Create: `src/modules/job/application/constants/reference-data-cache.constants.ts`

**Interfaces:**
- Produces: `REFERENCE_DATA_CACHE_TTL_MS`, `ReferenceDataCacheKey`
- Consumes: Nothing

- [ ] **Step 1: Create typed cache constants**

```ts
export const REFERENCE_DATA_CACHE_TTL_MS = 3_600_000;

export const ReferenceDataCacheKey = {
  Categories: 'reference-data:categories:v1',
  Arrangements: 'reference-data:arrangements:v1',
  Skills: 'reference-data:skills:v1',
} as const;
```

- [ ] **Step 2: Run compiler verification**

Run: `npm run build`

Expected: exit code `0`.

### Task 2: Category read-through cache

**Files:**
- Modify: `src/modules/job/application/services/category.service.ts`
- Create: `src/modules/job/application/services/category.service.spec.ts`

**Interfaces:**
- Consumes: `IApplicationCache`, `REFERENCE_DATA_CACHE_TTL_MS`, `ReferenceDataCacheKey.Categories`
- Produces: cached behavior for `ICategoryService.getAllCategoriesAsync()`

- [ ] **Step 1: Write category service tests**

Create tests with mocked `ICategoryRepository` and `IApplicationCache` for:

```ts
it('returns cached categories without querying the repository', async () => {
  cache.get.mockResolvedValue([{ id: 1, name: 'Engineering' }]);
  const result = await service.getAllCategoriesAsync();
  expect(result._unsafeUnwrap()).toEqual([{ id: 1, name: 'Engineering' }]);
  expect(repository.getAllCategories).not.toHaveBeenCalled();
});

it('caches repository categories for one hour after a miss', async () => {
  cache.get.mockResolvedValue(undefined);
  repository.getAllCategories.mockResolvedValue(
    ok([{ id: 1, name: 'Engineering' }]),
  );
  await service.getAllCategoriesAsync();
  expect(cache.set).toHaveBeenCalledWith(
    ReferenceDataCacheKey.Categories,
    [{ id: 1, name: 'Engineering' }],
    REFERENCE_DATA_CACHE_TTL_MS,
  );
});
```

Also test cached `[]`, cache-read rejection fallback, cache-write rejection success, and repository `err` mapping.

- [ ] **Step 2: Run tests and confirm pre-implementation failure**

Run: `npx jest src/modules/job/application/services/category.service.spec.ts --runInBand`

Expected: FAIL because `CategoryService` does not inject or use `IApplicationCache`.

- [ ] **Step 3: Implement category cache-aside flow**

Inject `IApplicationCache`. Read `ReferenceDataCacheKey.Categories`; return any value other than `undefined`. Catch and log cache-read errors. On a repository success, attempt `cache.set` with `REFERENCE_DATA_CACHE_TTL_MS`; catch and log cache-write errors. Preserve current repository error mapping.

- [ ] **Step 4: Run category tests**

Run: `npx jest src/modules/job/application/services/category.service.spec.ts --runInBand`

Expected: PASS.

### Task 3: Arrangement read-through cache

**Files:**
- Modify: `src/modules/job/application/services/arrangement.service.ts`
- Create: `src/modules/job/application/services/arrangement.service.spec.ts`

**Interfaces:**
- Consumes: `IApplicationCache`, `REFERENCE_DATA_CACHE_TTL_MS`, `ReferenceDataCacheKey.Arrangements`
- Produces: cached behavior for `IArrangementService.getAllArrangementsAsync()`

- [ ] **Step 1: Write arrangement service tests**

Cover cache hit, cached empty array, cache miss with one-hour `set`, cache-read rejection fallback, cache-write rejection success, and repository error mapping. Assert this exact write:

```ts
expect(cache.set).toHaveBeenCalledWith(
  ReferenceDataCacheKey.Arrangements,
  [{ id: 1, name: 'Remote' }],
  REFERENCE_DATA_CACHE_TTL_MS,
);
```

- [ ] **Step 2: Run tests and confirm pre-implementation failure**

Run: `npx jest src/modules/job/application/services/arrangement.service.spec.ts --runInBand`

Expected: FAIL because `ArrangementService` does not inject or use `IApplicationCache`.

- [ ] **Step 3: Implement arrangement cache-aside flow**

Use the arrangement cache key. Preserve the same fail-open rules and current `AppError` mapping as category.

- [ ] **Step 4: Run arrangement tests**

Run: `npx jest src/modules/job/application/services/arrangement.service.spec.ts --runInBand`

Expected: PASS.

### Task 4: Skill list service and cache

**Files:**
- Create: `src/modules/job/application/interfaces/skill.service.interface.ts`
- Create: `src/modules/job/application/services/skill.service.ts`
- Create: `src/modules/job/application/services/skill.service.spec.ts`
- Modify: `src/modules/job/application/dtos/job.response.dto.ts`
- Modify: `src/modules/job/api/skill.controller.ts`
- Modify: `src/modules/job/job.module.ts`

**Interfaces:**
- Consumes: `ISkillRepository.getAllSkills()`, `IApplicationCache`, `ReferenceDataCacheKey.Skills`
- Produces: `ISkillService.getAllSkillsAsync(): Promise<Result<SkillResponseDto[], AppError>>` and `GET /skills`

- [ ] **Step 1: Add skill response and service contracts**

```ts
export type SkillResponseDto = {
  id: number;
  name: string;
};

export abstract class ISkillService {
  abstract getAllSkillsAsync(): Promise<Result<SkillResponseDto[], AppError>>;
}
```

- [ ] **Step 2: Write skill service tests**

Cover cache hit, cached empty array, cache miss with one-hour `set`, cache-read rejection fallback, cache-write rejection success, and repository error mapping. Assert this exact write:

```ts
expect(cache.set).toHaveBeenCalledWith(
  ReferenceDataCacheKey.Skills,
  [{ id: 1, name: 'TypeScript' }],
  REFERENCE_DATA_CACHE_TTL_MS,
);
```

- [ ] **Step 3: Run tests and confirm pre-implementation failure**

Run: `npx jest src/modules/job/application/services/skill.service.spec.ts --runInBand`

Expected: FAIL because `SkillService` does not exist.

- [ ] **Step 4: Implement skill service**

Mirror category error mapping and fail-open cache flow. Use `ReferenceDataCacheKey.Skills` and `REFERENCE_DATA_CACHE_TTL_MS`.

- [ ] **Step 5: Implement skill controller**

```ts
@Controller('skills')
@ApiTags('skills')
export class SkillController {
  constructor(private readonly skillService: ISkillService) {}

  @Get()
  @ApiOperation({ summary: 'List job skills' })
  async getSkills(): Promise<SkillResponseDto[]> {
    const result = await this.skillService.getAllSkillsAsync();
    return result.match(
      (value) => value,
      (error) => {
        throw toHttpException(error);
      },
    );
  }
}
```

- [ ] **Step 6: Wire skill service and controller in `JobModule`**

Add `SkillController` to `controllers`. Register `SkillService` and bind `ISkillService` with `useExisting`. Export `ISkillService` only if another module consumes it; otherwise keep it private.

- [ ] **Step 7: Run skill tests and build**

Run: `npx jest src/modules/job/application/services/skill.service.spec.ts --runInBand && npm run build`

Expected: all commands exit `0`.

### Task 5: Full verification

**Files:**
- Verify all changed files

**Interfaces:**
- Consumes: all prior task outputs
- Produces: verified reference-data caching feature

- [ ] **Step 1: Run focused tests**

Run: `npx jest src/modules/job/application/services/category.service.spec.ts src/modules/job/application/services/arrangement.service.spec.ts src/modules/job/application/services/skill.service.spec.ts --runInBand`

Expected: 3 suites pass with zero failed tests.

- [ ] **Step 2: Run full unit suite**

Run: `npm test -- --runInBand`

Expected: all suites pass.

- [ ] **Step 3: Run static verification**

Run: `npm run build && npx eslint src/modules/job/application src/modules/job/api src/modules/job/job.module.ts && git diff --check`

Expected: all commands exit `0` with no ESLint errors or whitespace errors.

- [ ] **Step 4: Manually verify cache behavior with Redis**

Start dependencies and API, call each endpoint twice, then inspect Redis keys:

```bash
curl http://localhost:3000/categories
curl http://localhost:3000/arrangements
curl http://localhost:3000/skills
redis-cli -u "$REDIS_URL" --scan --pattern 'reference-data:*'
```

Expected keys:

```text
reference-data:categories:v1
reference-data:arrangements:v1
reference-data:skills:v1
```

Each key must have a positive TTL no greater than `3_600_000` milliseconds.
