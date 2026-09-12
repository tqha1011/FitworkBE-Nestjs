# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A NestJS 11 + Prisma 7 (PostgreSQL) backend template. Global `ConfigModule`, global `ValidationPipe`, a global exception filter, JWT auth guard, role guard, Swagger at `/docs`, and Husky/commitlint git hooks are already wired up in `src/app.module.ts` / `src/main.ts`.

## Commands

```bash
npm install
cp .env.example .env        # then fill DATABASE_URL, DIRECT_URL, JWT_SECRET, etc.
npx prisma generate         # required after clone and after any prisma/models/*.prisma change —
                             # generated/prisma is gitignored and not committed
npm run start:dev           # dev server with watch, http://localhost:3000, Swagger at /docs
npm run build                # nest build; also what pre-push and CI run
npm run lint                 # eslint --fix over src/apps/libs/test
npm run format                # prettier --write
npm run test                  # jest unit tests (rootDir: src, pattern *.spec.ts)
npx jest path/to/file.spec.ts # run a single unit test file
npm run test:e2e              # jest -c test/jest-e2e.json (test/app.e2e-spec.ts)
npm run scaffold <name>       # generate an empty hexagonal module skeleton at src/modules/<name>
npm run doctor                 # sanity-checks local env (.env present, required keys set, Docker up)
```

Prisma schema is split across `prisma/models/*.prisma` (loaded together via `prisma/schema.prisma`); there is no single schema file to open. After editing any model file, run `npx prisma generate` (and `npx prisma format` / `npx prisma validate` are worth running too — Prisma will error on missing back-relations, e.g. every `@relation` on the "many" side needs a matching list field on the "one" side).

No unit tests exist yet under `src/` (only the default `test/app.e2e-spec.ts`). There's no single-test npm script — invoke `npx jest` directly with a path filter.

## Architecture

### Per-module hexagonal layout

Each feature lives in its own `src/modules/<name>/` with four fixed subfolders — this is enforced by `npm run scaffold` (`scripts/scaffold-cli.ts`), not just a convention:

```
<name>/
  api/                  <name>.controller.ts        — HTTP layer, calls the service interface
  application/
    dtos/                <name>.request.dto.ts        — class + class-validator decorators
                          <name>.response.dto.ts       — plain `type` alias, not a class
    interfaces/           <name>.service.interface.ts  — abstract class = DI token + contract
                          <name>.query-repo.interface.ts
    services/             <name>.service.ts            — business logic, returns neverthrow Result
  domain/
    entities/              <name>.entity.ts
    errors/                 <name>-domain.error.ts
    repositories/           <name>.repo.interface.ts     — abstract class(es) = DI token + contract
  infrastructure/           <name>.repo.ts               — Prisma-backed implementation
  <name>.module.ts
```

Cross-module dependencies happen through the domain interface, not the concrete class: e.g. `AuthModule` imports `UsersModule` and injects `IUserRepository` (exported by `UsersModule`), never `UsersRepository` directly.

### DI tokens are abstract classes, not string tokens or plain interfaces

Every repository/service "interface" (`IUserRepository`, `IAuthService`, `IPasswordHasher`, `ITokenProvider`, `IRefreshTokenRepository`, `IRefreshTokenProvider`, ...) is declared as an `export abstract class` with `abstract` methods, not a TS `interface`. This lets it double as both the compile-time contract and the runtime Nest DI token:

```ts
// domain/repositories/foo.repo.interface.ts
export abstract class IFooRepository {
  abstract findById(id: number): Promise<Result<Foo | null, Error>>;
}

// foo.module.ts
providers: [{ provide: IFooRepository, useClass: FooRepository }]

// consumer
constructor(private readonly fooRepository: IFooRepository) {}
```

Method names on these classes are camelCase (`findByEmail`, `addRefreshToken`, `generateAccessToken`, ...) — keep new methods consistent with that.

### Error handling: neverthrow all the way, converted to HTTP at the controller boundary

- Infrastructure and provider methods return `Promise<Result<T, Error>>` (`neverthrow`), wrapping the operation in try/catch (see any `*.repo.ts`).
- Service methods return `Promise<Result<T, AppError>>`, where `AppError` (`src/shared/common/errorCode.ts`) carries an `ErrorCode` (`Conflict`, `NotFound`, `Unauthorized`, ...).
- Controllers convert the error channel to an HTTP exception with `toHttpException` (`src/shared/common/app-error.mapper.ts`) via `result.match(value => value, error => { throw toHttpException(error); })`. Don't throw `HttpException` subclasses directly from services — return an `err(new AppError(...))` instead.

### Auth

- Access tokens are short-lived JWTs signed via `@nestjs/jwt` (`JwtModule.registerAsync` in `auth.module.ts`, secret/expiry from `JWT_SECRET` / `JWT_ACCESS_EXPIRES_IN_SECONDS`). `JwtAuthGuard` + the `@Auth()` decorator (`src/shared/common/swagger/auth-swagger.decorator.ts`) protect a route and expect a `Bearer` header; `@User()` reads the decoded payload.
- Refresh tokens are opaque random values (`RefreshTokenProvider`, 32 random bytes), stored hashed (SHA-256) in the `refresh_token` table — never the raw value. The raw token is delivered to the browser as an `HttpOnly`, `SameSite=Lax` cookie scoped to `Path=/auth/refresh` (see `AuthController`), never in a JSON body.
- Every successful `/auth/refresh` call rotates the token (old one revoked, new one issued). If an already-revoked token is presented again, that's treated as theft/replay and **all** refresh tokens for that user are revoked (`AuthService.refreshTokensAsync`).
- Role handling has two related-but-distinct enums: `UserType` (`COMPANY` / `APPLICANT`, business classification on `User`) and `CommonUserRole` / Prisma `UserRole` (`ROLE_COMPANY` / `ROLE_APPLICANT`, the JWT claim), mapped 1:1 via `userTypeToRole` in `AuthService` and `src/modules/users/infrastructure/user.mapper.ts`. There's also an unrelated `SystemRole` (`Admin`/`User`) in `src/shared/domain/enum.ts` used by `RolesGuard`/`@Roles()` — it is not currently derived from anything on `User`.

### Prisma conventions

- Every model/enum uses `@map`/`@@map` to keep `snake_case` table and column names in Postgres while the Prisma schema and generated TS stay `camelCase`/`PascalCase`.
- `publicId` (a UUID) is the identifier ever exposed to clients/JWTs; the internal `Int` `id` is only used for joins and never leaves the repository layer.
- The Prisma client is generated to `generated/prisma` (custom `output` in the `client` generator) and imported as `from 'generated/prisma/...'`, not `@prisma/client`.

## Git hooks / CI

- `pre-commit` runs `npx lint-staged` (config in `package.json`, `*.ts` → `eslint --fix`).
- `pre-push` runs `npm run build`.
- `commit-msg` runs commitlint (`commitlint.config.cjs`, conventional commits, subject min length 10 — e.g. `feat: add auth module`).
- GitHub Actions (`.github/workflows/backend_ci.yml`) runs on push/PR to `develop`/`main`: `npm ci` → `npx prisma generate` → `npm run lint` → `npm run build`.
