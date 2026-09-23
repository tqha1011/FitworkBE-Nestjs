# Evaluation Criteria Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal, versioned criterion contract so an evaluation can judge each job requirement and ground its result in resume evidence.

**Architecture:** Criteria are derived from the immutable job snapshot and stored as JSON inside the existing evaluation input/result records for the first version. No new `JobCriterion` table is introduced yet because criteria are evaluation-time, job-specific, and must remain reproducible with the captured job snapshot. A separate table can be added later if recruiters need to edit, reuse, or report on criteria independently.

**Tech Stack:** NestJS, TypeScript, Prisma JSON fields, Gemini structured JSON output, Jest.

**Spec:** The user-provided AI matching Evaluation V2 requirements in the conversation.

## Global Constraints

- Criteria schema is fixed; criterion values are job-specific.
- Resume and job text remain untrusted input to the LLM.
- V2 evidence must be validated against the exact normalized/redacted resume snapshot before persistence.
- V1 evaluation records remain readable during rollout.
- The final score is computed from validated criterion contributions, not an unrelated LLM overall score.

## Review Focus

- A job with no extracted criteria must fail validation rather than silently produce a generic score.
- An LLM response containing an unknown `criterionId` must be rejected.
- A criterion with a fabricated or out-of-range evidence offset must be rejected.
- A V1 persisted evaluation must still map successfully.
- Criteria must be captured in the job snapshot so later job edits cannot change an old evaluation.

---

### Task 1: Add domain contracts for versioned job criteria

**Files:**
- Modify: `src/modules/job/domain/value-objects/job-snapshot.ts`
- Modify: `src/modules/applicant-evaluation/domain/value-objects/evaluation.ts`
- Test: `src/modules/applicant-evaluation/domain/value-objects/evaluation.spec.ts`

**Interfaces:**
- Produce `JobSnapshotV2` with `criteria: JobCriterion[]`.
- Produce `JobCriterion` with `id`, `text`, `category`, `weight`, and `required`.
- Produce `EvaluationEvidenceV2` with one `EvaluationCriterionResult` per criterion.

- [ ] **Step 1: Write tests for the criterion shapes and verdict values.**
- [ ] **Step 2: Run the focused tests and verify they fail because the V2 types do not exist.**
- [ ] **Step 3: Add the minimal TypeScript contracts without changing V1 types.**
- [ ] **Step 4: Run the focused tests and verify they pass.**

### Task 2: Build criteria from the existing job snapshot

**Files:**
- Create: `src/modules/applicant-evaluation/application/services/applicant-evaluation-criteria.service.ts`
- Create: `src/modules/applicant-evaluation/application/services/applicant-evaluation-criteria.service.spec.ts`
- Modify: `src/modules/job/domain/value-objects/job-snapshot.ts`

**Interfaces:**
- Consume `JobSnapshotV1`.
- Produce `JobSnapshotV2` with stable criterion IDs derived from existing job skills and requirements.

- [ ] **Step 1: Write tests showing job skills become criteria and duplicate skills are deduplicated.**
- [ ] **Step 2: Write a test showing each criterion has a deterministic ID and valid weight.**
- [ ] **Step 3: Implement the service using existing `jobSnapshot.skills` and requirements text; keep extraction deterministic for this scaffold.**
- [ ] **Step 4: Run the service tests and verify they pass.**

### Task 3: Extend the Gemini response contract for criterion-level output

**Files:**
- Modify: `src/modules/applicant-evaluation/infrastructure/llm/applicant-evaluation-response.schema.ts`
- Modify: `src/modules/applicant-evaluation/infrastructure/llm/applicant-evaluation-response.validator.ts`
- Modify: `src/modules/applicant-evaluation/infrastructure/llm/applicant-evaluation-prompt.builder.ts`
- Modify: `src/modules/applicant-evaluation/application/interfaces/applicant-evaluation-llm.interface.ts`
- Test: existing response schema/validator specs

**Interfaces:**
- Consume `JobSnapshotV2.criteria`.
- Produce `ApplicantEvaluationLlmOutput` schema version 2 with criterion results and optional summary fields.

- [ ] **Step 1: Add failing validator tests for matched, partial, missing, unknown criterion, and missing evidence.**
- [ ] **Step 2: Extend the JSON schema and validator to require one result per known criterion.**
- [ ] **Step 3: Update the prompt to explicitly say criteria and resume content are untrusted data.**
- [ ] **Step 4: Run the focused LLM contract tests and verify they pass.**

### Task 4: Persist criteria in existing JSON snapshots and results

**Files:**
- Modify: `src/modules/applicant-evaluation/domain/repositories/applicant-evaluation.repo.interface.ts`
- Modify: `src/modules/applicant-evaluation/infrastructure/applicant-evaluation.repo.ts`
- Modify: `src/modules/applicant-evaluation/infrastructure/applicant-evaluation.mapper.ts`
- Modify: `src/modules/applicant-evaluation/application/services/applicant-evaluation.processing.service.ts`
- Test: repository and processing service specs

**Interfaces:**
- Persist V2 criteria inside the immutable `jobSnapshot` JSON and V2 evidence inside the existing `evidence` JSON field.
- Keep V1 mapping and persistence behavior intact.

- [ ] **Step 1: Add tests proving criteria are captured before queueing and returned with V2 evidence.**
- [ ] **Step 2: Add V2 mapping and reject malformed persisted criteria/evidence.**
- [ ] **Step 3: Compute `overallScore` from validated criterion contributions.**
- [ ] **Step 4: Run repository and processing tests.**

### Task 5: Add synthetic regression fixtures

**Files:**
- Create: `test/fixtures/applicant-evaluation/golden-criteria.json`
- Create: `src/modules/applicant-evaluation/infrastructure/llm/applicant-evaluation-criteria.e2e-spec.ts`

- [ ] **Step 1: Add a synthetic resume with matched, partial, missing, and prompt-injection content.**
- [ ] **Step 2: Assert prompt-injection text cannot change the response contract.**
- [ ] **Step 3: Assert evidence snippets resolve against the exact snapshot.**
- [ ] **Step 4: Run the regression test and confirm V1 compatibility remains green.**

