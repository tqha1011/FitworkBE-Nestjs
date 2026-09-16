---
name: fitwork-backend
description: Implement, refactor, review, or test features in the Fitwork NestJS 11 and Prisma 7 backend while preserving its module boundaries, error handling, database conventions, and validation workflow.
---

# Fitwork Backend Development

Use this skill for changes to this repository's API, feature modules, shared backend code, tests, or Prisma schema. Read the root `AGENTS.md` before editing.

## Preserve the Architecture

- Keep features in `src/modules/<feature>/` with `api`, `application`, `domain`, and `infrastructure` layers. Use `npm run scaffold -- <kebab-case-name>` for a new module, then complete and verify its generated wiring.
- Controllers depend on application service contracts. Cross-module consumers depend on exported domain contracts, never concrete repository implementations.
- Define injectable contracts as exported abstract classes such as `IUserRepository`; they serve as both TypeScript contracts and Nest dependency-injection tokens.
- Return infrastructure failures as `Promise<Result<T, Error>>` and application failures as `Promise<Result<T, AppError>>` using `neverthrow`. Convert `AppError` to an HTTP exception only at the controller boundary with `toHttpException`.
- Follow existing DTO patterns: validated classes for request DTOs and explicit response types that do not leak persistence models.

## Respect Data and Authentication Invariants

- Edit models in `prisma/models/*.prisma`; `prisma/schema.prisma` contains the shared generator and datasource configuration.
- Keep Prisma fields and models camelCase/PascalCase while mapping PostgreSQL columns and tables to snake_case with `@map` and `@@map`.
- Expose UUID `publicId` values through APIs and JWTs. Keep internal integer IDs inside the repository layer.
- Import the generated client from `generated/prisma/...`, not `@prisma/client`, and never commit generated output.
- Preserve refresh-token rotation, hashed token storage, replay revocation, and HttpOnly cookie behavior when modifying authentication.

## Validate Changes

Choose checks proportional to the change:

1. Run focused Jest tests, then `npm test` or `npm run test:e2e` when relevant.
2. After schema edits, run `npx prisma format`, `npx prisma validate`, and `npx prisma generate`.
3. Run `npm run lint` and inspect its automatic fixes.
4. Run `npm run build` before handing off code changes.

Add `*.spec.ts` beside source code and `*.e2e-spec.ts` under `test/`. Cover successful behavior plus validation, authorization, and mapped error paths where applicable. Report which checks ran and any checks that could not run.
