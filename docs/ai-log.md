# AI usage log

The brief asks us to use AI and show it. I used Claude Code as a pair programmer: it drafted options
and code, and I made the calls. This log records where I steered it, and what I accepted or rejected.

## Session 1: planning (2026-10-05/06)

- **I asked for** an approach covering business thinking, observability, error handling, design patterns,
  and unit + load testing.
- **AI suggested** Postgres + Drizzle + Vitest, plus "multi-tenant-ready seams".
- **I changed:**
  - MySQL instead of Postgres.
  - Prisma instead of Drizzle. I asked about Sequelize; the AI pushed back on its TypeScript support, and I agreed.
  - Jest instead of Vitest, for team familiarity.
  - Kept Zod over Joi after discussing how a separate schema and type can drift apart.
  - **Skipped multi-tenancy** entirely, to keep the scope focused.
- **Accepted:** hexagonal-lite layering, Strategy scorers, stale-while-revalidate caching, result unions,
  and a mock upstream for load tests.

## Session 2: M1 scaffold (2026-10-06)

- **I asked for** express-async-errors and one central place for error and success responses.
  - **AI pointed out** that express-async-errors only patches Express 4, and Express 5 handles async errors
    natively.
  - I chose Express 5's native handling, plus a shared error mapper and response envelope (ADR-005).
- **I asked for** explicit SQL-injection protection, which led to ADR-004 (lint bans, least-privilege DB
  users, input allow-lists).
- **Version reality check** (the AI's suggestion, verified with `npm view`):
  - Apollo Server 4 is end-of-life, so we're using v5.
  - TypeScript 7 isn't supported by ts-jest or typescript-eslint yet, so it's pinned to 6.0.
  - Apollo requires graphql v16.
- **Caught while testing the build:** expected 404s were logged with full stack traces. Now only unexpected
  errors log a stack trace.

## Session 2b: M1 review (2026-10-06)

- **I pushed back:** unhandled rejections and signal-based shutdown seemed to be missing. The AI showed they
  were in `index.ts`, but agreed with the underlying concern: they were untested, an instant exit dropped
  in-flight requests, and there was no readiness flag or resource cleanup. They were rewritten as a
  tested module.
- **I asked** what CI means here. It's the GitHub Actions workflow in `.github/workflows/ci.yml`, which runs
  the same checks on every push.

## Session 3: M2 scoring (2026-10-07)

- The AI proposed the "start at 100, named adjustments" model. I kept it over a weighted-sum model
  because every score can be explained to a user (and to the interview panel).
- Thresholds (snow depth, wave sweet spot 1–2.5 m, comfort band 15–25°C) are judgement calls, kept
  in config, with the reasoning in ADR-006 and the PM questions doc.
- While building, the AI moved the config type into the domain to keep dependencies pointing inwards.

## Session 4: Slice 1 (2026-10-07)

- **I asked** to implement the use cases one at a time and test them in Postman, since there's no UI.
  The AI proposed re-cutting the remaining layer milestones into vertical slices. I agreed.
- The AI inspected the live API first. That's how we learned that inland marine returns 200 + nulls, which shaped the design.
- The AI wrote the Postman collection as a generator script (reviewable diffs) and ran it with newman before
  handing it over.
- **AI-caught issue:** the indoor rating looks too generous in sunny weeks. I left it as a PM question rather than retune silently.
