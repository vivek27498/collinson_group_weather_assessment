# ADR-001: MySQL with Prisma

**Status:** accepted

## Context

Forecasts must be persisted, not fetched per request. The data is small and relational
(locations → snapshots → daily rows), and it's read far more often than it's written.

## Decision

MySQL 8.4, accessed through Prisma 7 with the MariaDB driver adapter (Prisma 7's way of talking to MySQL).

## Alternatives considered

- **Postgres**: equally good technically. MySQL was chosen as the team-familiar default.
- **Sequelize**: familiar, but its TypeScript support is weak (manual attribute typing, loosely typed queries).
- **Drizzle**: excellent and close to SQL, but less familiar to most reviewers.
- **Redis only**: fine as a cache, but we want durable history and SQL queries.

## Consequences

- A typed client is generated from `prisma/schema.prisma`, and migrations are versioned SQL files.
- Prisma parameterises every query (see ADR-004).
- Bulk writes go through `createMany` inside a `$transaction`.
