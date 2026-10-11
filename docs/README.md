# Fitwork project specification

This documentation describes the implemented backend at source revision `74499d7`, reviewed on **2026-10-11**. It is an implementation specification for developers, frontend integrators, and operators. Planned behavior is not presented as an existing feature.

| Document                                            | Contents                                                                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| [Architecture](specification/architecture.md)       | Runtime topology, modules, layers, dependency injection, storage, queues, caching, and observability             |
| [Database schema](specification/database-schema.md) | ER diagram, all 13 models and 8 enums, field dictionary, foreign keys, uniqueness, indexes, and migrations       |
| [API contracts](specification/api-contracts.md)     | Implemented REST routes, authentication, payloads, responses, error behavior, and Socket.IO events               |
| [Business workflows](specification/workflows.md)    | Authentication, resume ingestion, applications, evaluation versions, evidence validation, and hiring transitions |
| [Operations](specification/operations.md)           | Configuration, local setup, migrations, containers, telemetry, verification, and operational boundaries          |

Start with architecture for the system overview, then use the schema and API contracts together when implementing a feature. The [root README](../README.md) contains the quick start, feature overview, and benchmark results. Runtime Swagger is available at `/docs`.

## Scope and conventions

- The HTTP API, Socket.IO gateways, and BullMQ workers run in one NestJS application. PostgreSQL is the durable business-data store; Redis supplies queues and caching; uploaded files live in S3-compatible object storage.
- REST identity comes from the JWT `sub` claim, which contains a user's `publicId`. Internal integer primary keys are used for database relations. Reference-data APIs expose integer IDs.
- Field names in API examples use camelCase. Physical database names use snake_case where mapped by Prisma. Date responses serialize to ISO 8601 strings; monetary API fields are JSON numbers.
- “Current behavior” describes the source implementation, including limitations. Database constraints and application checks are distinguished explicitly.
- Source links are relative to this repository. Read the linked source when changing a contract; update the corresponding specification in the same change.

## Maintaining the specification

| Change                                                                 | Documents to update                                        |
| ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| Controller, request/response DTO, guard, or realtime event             | API contracts and affected workflows                       |
| Prisma model, migration, relation, or index                            | Database schema; workflows if persistence semantics change |
| Service rules, state transitions, retry policy, or evaluation versions | Workflows and API contracts                                |
| Module wiring or external integration                                  | Architecture and operations                                |
| Environment variable, Docker/CI configuration, or telemetry pipeline   | Operations                                                 |

These documents do not replace Prisma migrations, DTO validators, executable tests, or runtime Swagger. Differences should be resolved against the implementation and then reflected here.
