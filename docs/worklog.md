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

## 2026-10-07: M2, domain + scoring

- Pure domain: `src/domain/types.ts`, the WMO weather-code categories, scoring primitives (ramp / fixed
  adjustments + reasons), 4 Strategy scorers, a registry, and weekly ranking. No I/O anywhere in the domain.
- Layering fix while building: the `ScoringConfig` _type_ moved into the domain, and `src/config/scoring.ts`
  holds only the values, so the domain never imports from the config layer.
- Indoor reuses the outdoor scorer (composition), so the two can't disagree about the weather.
- Tests: a test-data builder (`test/support/builders.ts`) so each case only states what's different;
  table-driven boundary cases with hand-computed expected scores; stub scorers to test ranking in
  isolation; 3 scenario tests (alpine winter, surf town summer, rainy city) through the real registry.
- 186 unit tests pass; the domain has 100% line coverage.
- Small catch: the tests called concrete scorer classes with a location argument they don't declare.
  Production always uses the `ActivityScorer` interface, so the tests now do too.
- Decisions: ADR-006 (scoring model, alternatives, known simplifications).
- Next: M3, the Open-Meteo adapters (geocoding, forecast, marine) with timeout and retry.

## 2026-10-07: Slice 1, rank a city end to end (UC1–5, UC7)

- **Re-planned into vertical slices** (see plan.md): with no UI, every use case should be testable in Postman as soon as it lands.
- Checked the real API before writing adapters, and recorded fixtures:
  - The Marine API returns **HTTP 200 with all-null waves inland**, not an error. "Not applicable" is detected from the data.
  - Geocoding **omits `results`** when nothing matches.
  - Snow depth is hourly only, so we take each day's max.
- HTTP: `FetchJsonClient` (timeout + failure classification) wrapped by `RetryingJsonClient` (Decorator:
  exponential backoff with full jitter; retries only 5xx/429/network/timeout).
- Adapters validate every payload with Zod (anti-corruption layer); a contract break is a non-retryable error.
- `RankingService`: "location not found" is a **value** (a GraphQL union member), not an exception. Marine
  failure degrades gracefully (rank the rest + a `warnings` entry); a forecast failure fails the request.
- GraphQL: Apollo 5, formatError reuses the shared error mapper, no stack traces in any environment,
  introspection off in production, landing page off (Postman is the client), CSRF prevention on.
- **Bugs caught by tests:**
  - Timeout detection used `instanceof Error`, but the abort reason is a DOMException that can come from
    another realm (Jest's sandbox), so timeouts were reported as network errors. Now it checks `name`.
  - Live run: the old M1 Docker container was still bound to :4000 and answered with 404s.
  - A partially deleted `node_modules` (tslib missing; a native file locked by a VS Code process) was fixed
    with a clean reinstall.
- Verified live: Chamonix/Biarritz/London/Madrid/Bergen. Bergen ranked indoor first because of rain (UC5).
- Postman collection (13 requests, 36 assertions) generated from `postman/build-collection.py`, all passing
  via newman. Manual guide in docs/manual-testing.md, including how to simulate outages.
- npm audit: 0 vulnerabilities in production deps. 20 moderate in dev-only tooling (sprintf-js via Jest's
  coverage chain); not shipped, left for Dependabot.
- **Follow-ups:**
  - Retry warnings use the app logger, so they lack the request id. Fix in slice 4 with AsyncLocalStorage.
  - Indoor often rates EXCELLENT in sunny weeks (see PM question #13).
- Tests: 235 passing (unit + integration with nock), with no live network access in tests.

## 2026-10-07: Slice 2, ambiguity, validation, abuse limits (UC6)

- Validation moved into the use case (`parseRankingInput`) so any future transport gets the same rules.
  It's an allow-list (letters in any script, marks, spaces, `'’.-`). Input is normalised (NFC, trim,
  collapse spaces) so equivalent queries share a cache key. One message per field.
- `InvalidInput` and `alternatives` (same-name places, max 5) added to the schema. "Paris" → France,
  with Paris, Texas etc. listed; `countryCode` picks one.
- Abuse limits, all checked before any upstream call:
  - Per-IP rate limit on /graphql with RateLimit-* headers and a 429 envelope.
  - Custom `maxRootFields` rule against alias amplification (`a: activityRankings b: ... x500`).
  - Depth limit.
  - Batching off.
- **Finding:** the depth-limit integration test passed straight through. graphql-depth-limit ignores
  introspection fields, and our schema has no recursive types, so real queries can't exceed depth ~4.
  The depth limit is defence-in-depth, tested at unit level with a low limit. Introspection itself is off in production.
- Tests: 292 passing. Postman: 19 requests / 53 assertions via newman.

## 2026-10-07: Slice 3, persistence and caching (UC8)

- Prisma 7 (MariaDB driver adapter) on MySQL 8.4. Schema: locations, geocode_queries,
  forecast_snapshots (one per 0.1° grid cell), daily_forecasts. Migrations run as `migrator` via a
  one-shot compose service; the app connects as `app` (DML only).
- ForecastService: cache-aside + stale-while-revalidate + single-flight. CachedGeocoder: decorator
  with positive and negative TTLs. RankingService is now just orchestration.
- /readyz pings MySQL. Shutdown order: Apollo → drain background refreshes → DB disconnect.
- Measured: cold Chamonix call 2.2 s, cached 44 ms. Fresh compose stack: 1.2 s cold, 17-22 ms cached.
- **Four real bugs found by verifying for real:**
  1. **MySQL 8 auth:** the MariaDB driver couldn't authenticate against a _fresh_ MySQL
     (`caching_sha2_password` needs TLS or RSA key retrieval). Local dev only worked because the
     server had cached the app user's credentials from an earlier CLI login. Caught by Testcontainers.
     Dev/compose now use `allowPublicKeyRetrieval=true`; production should use TLS (ADR-004).
  2. **Timeout too tight:** Open-Meteo's forecast endpoint measured 1.4-3.1 s; a 3 s timeout aborted
     healthy responses and the retries added load. Now 6 s, 1 retry.
  3. **Apollo's own signal handlers** re-sent SIGTERM after stopping. Our controller treated that as
     a second Ctrl+C and force-exited (exit 1), skipping the DB disconnect. Found with `docker stop`;
     fixed with `stopOnTerminationSignals: false`, and it now exits 0.
  4. **Jest + Prisma 7:** the generated client uses `.js` import specifiers and a dynamic import();
     fixed with a moduleNameMapper and `--experimental-vm-modules`.
- Tests: 334 passing, including 12 against a real MySQL in Testcontainers (round-trips, no timezone
  shift, utf8mb4, injection payloads stored as data with the schema intact). Postman: 22 requests, 58 assertions.
