# Worklog

Unpolished notes on how the work is going, newest last. Cuts and the reasons for them go here too.

## 2026-10-06: planning

- Read the brief. It is deliberately loose, and it grades _how I worked_ above the service itself. So decisions, assumptions and open questions get written down as I go.
- Chose a focused design over an exhaustive one: hexagonal-lite layers, pure Strategy scorers, normalised weather stored and scores computed at read time.
- Decisions so far (reasons are in docs/plan.md):
  - **MySQL + Prisma**: Sequelize rejected for weak TypeScript types; Drizzle for being less familiar to reviewers.
  - **Jest (ts-jest)**: chosen for team familiarity; CommonJS build avoids ESM friction.
  - **Zod**: types inferred from schemas, so no drift (Joi rejected for that reason).
  - **Apollo Server 4 + Express**.
  - **No multi-tenancy**: weather is not tenant data and the brief asks for focus. The README will say what real tenancy would add.
- Open-Meteo's free tier is non-commercial with a daily call limit, so load tests will run against a mock upstream and never the real API.
- Next: milestone 1 (scaffold) in docs/plan.md.

## Resuming on another machine

1. `git pull`
2. Start Claude Code in the repo and say: "Read docs/plan.md and docs/worklog.md, then continue from the next milestone."
3. Commit small and often; update this file at the end of each session.

## 2026-10-06: M1, scaffold + tooling + error handling

- Tooling: TypeScript 6 (strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes), Jest 30 + ts-jest
  (unit and integration projects), ESLint strict-type-checked + security plugin + SQL-injection bans,
  Prettier, CI, Dependabot.
- Dependencies are added in the milestone that first uses them (Prisma in M4, Apollo in M6), so each
  commit's package.json change matches what it contains.
- Centralised error policy + REST response envelope (ADR-005). Express 5 instead of express-async-errors.
- Docker: MySQL 8.4 with `app` (DML only) and `migrator` users, and a multi-stage non-root app image.
- Verified: 47 unit tests pass (100% lines, 90% branches); lint + typecheck clean; the prod build boots;
  /healthz and 404 envelopes are correct; bad config exits 1 without echoing secrets; lint rejects all
  three unsafe-SQL test calls.
- Fixed after testing the build: expected 404s were logged with full stack traces.
- Next: M2 (domain + scoring, TDD).

## 2026-10-06: M1 review fixes

- **Least privilege verified against real MySQL.** `app` can INSERT/SELECT/UPDATE/DELETE, but
  DROP/CREATE/ALTER and reading `mysql.user` fail with ERROR 1142. `migrator` can run DDL.
- The host port for MySQL is now configurable (default 3307), because a natively installed MySQL
  already listens on 3306 on this machine.
- **Review feedback (mine): process-level error handling and shutdown were inline in index.ts and untested.**
  Moved them to `src/shared/process/graceful-shutdown.ts`:
  - Idempotent shutdown: flip readiness → stop accepting + close idle keep-alive sockets → drain in-flight
    → close resources in reverse order → exit.
  - Force exit after a timeout. A second Ctrl+C exits immediately.
  - unhandledRejection / uncaughtException: log at fatal, then drain and exit 1 (previously an instant
    exit that dropped in-flight requests).
  - `/readyz` returns 503 `SHUTTING_DOWN` while draining, so a load balancer stops routing new requests.
  - 15 new tests, including a real HTTP server: the in-flight request completes and new connections are refused.
- Gotcha: on Windows, "localhost" is dual-stack, so a refused connection surfaced as an AggregateError with an
  empty message. That failed an assertion and left a socket open, which hung Jest. Fixed by pinning
  127.0.0.1, asserting on `code`, and cleaning up in `finally`.
- **Verified for real:** `docker stop` (SIGTERM) on the built image logs a graceful sequence and exits 0.
