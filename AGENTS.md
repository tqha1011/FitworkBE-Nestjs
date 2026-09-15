# Repository Guidelines

## Project Structure & Module Organization

Application code lives in `src/`. Features belong in `src/modules/<feature>/` and follow the hexagonal layout: `api/` for controllers, `application/` for DTOs and services, `domain/` for entities and contracts, and `infrastructure/` for Prisma repositories and mappers. Shared guards, validation, error mapping, and database setup are under `src/shared/`.

Prisma definitions are split between `prisma/schema.prisma` and `prisma/models/*.prisma`; generated client code is excluded from Git. E2e tests live in `test/`; unit tests should be colocated with source as `*.spec.ts`. Utility CLIs are in `scripts/`.

## Build, Test, and Development Commands

- `npm ci`: install lockfile-defined dependencies (CI uses Node.js 24).
- `cp .env.example .env && npx prisma generate`: prepare local configuration and generate the Prisma client.
- `npm run doctor`: check required environment values and local prerequisites.
- `npm run start:dev`: run the API in watch mode; Swagger is at `/docs`.
- `npm run scaffold -- <kebab-case-name>`: create and register a feature module skeleton.
- `npm run build`: compile the NestJS application to `dist/`.
- `npm run lint`: run ESLint with automatic fixes; review resulting changes.
- `npm run format`: format TypeScript with Prettier.
- `npm test`, `npm run test:cov`, `npm run test:e2e`: run unit, coverage, and e2e suites.

After changing Prisma models, run `npx prisma format`, `npx prisma validate`, and `npx prisma generate`.

## Coding Style & Naming Conventions

Use TypeScript with two-space indentation, single quotes, trailing commas, and LF endings. Use `PascalCase` for classes/types and `camelCase` for methods/variables. Files use kebab-case and suffixes such as `.controller.ts`, `.service.ts`, `.request.dto.ts`, and `.repo.interface.ts`. DI contracts are abstract classes (for example, `IUserRepository`). Keep domain/application errors in `neverthrow` results and translate them to HTTP errors at controller boundaries.

## Testing Guidelines

Jest and `ts-jest` power both suites; Supertest supports e2e tests. Name unit tests `*.spec.ts` and e2e tests `*.e2e-spec.ts`. Cover success, validation, authorization, and error paths. No coverage threshold is configured. Run one test with `npx jest path/to/file.spec.ts`.

## Commit & Pull Request Guidelines

Use Conventional Commits, such as `feat: implement job controller` or `fix: handle duplicate job skill`; subjects must contain at least 10 characters. Before pushing, run lint, tests, Prisma generation when applicable, and build. PRs should include a behavior summary, linked issue, validation results, and API, environment, or schema notes. Include screenshots only for visual changes.
