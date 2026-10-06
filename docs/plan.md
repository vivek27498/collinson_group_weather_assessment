# Weather Activity Ranking Service: Plan

_Status: planning agreed, no code written yet. Next step: milestone 1._

## Context
Lead Engineer take-home exercise (5 days, public GitHub repo, TypeScript, Node.js, GraphQL). Input is a city or town. Output ranks the next 7 days for Skiing, Surfing, Outdoor sightseeing and Indoor sightseeing, using Open-Meteo data that we persist rather than fetching on every request.

The graders weigh **(1) how we worked** (decisions, assumptions, PM questions, the AI session, cuts) above **(2) the service and README**. The user wants a clean, scalable, secure and configurable design that isn't over the top. Every low-level pattern should be justified. Unit tests and load tests should be thorough, and the user must be able to explain and extend all of it live in the 90-minute interview.

**Decisions made with the user:** MySQL storage. No multi-tenancy (discussed in the README only). Apollo Server 4 + Express.

## Stack
- Node 20 LTS, TypeScript strict mode, CommonJS output.
- Apollo Server 4 + Express. `graphql-depth-limit` and a simple cost limit.
- MySQL 8 through **Prisma**: simple schema file, strongly typed client, `prisma migrate`. Daily forecast rows are written in a `$transaction` (createMany after deleting or replacing the snapshot). Sequelize was rejected for its weak TypeScript support, Drizzle for being less familiar. Write an ADR for this.
- **Zod** for env config and input validation (types inferred, one source of truth; Joi was considered and rejected because schema and type can drift). pino for logs. prom-client for metrics.
- **Jest + ts-jest** (CommonJS build to avoid ESM friction), nock to mock HTTP, Testcontainers (MySQL) for integration tests, k6 for load tests.
- Docker Compose (app + MySQL + mock upstream), GitHub Actions CI, ESLint + Prettier.

## Architecture (hexagonal-lite)
```
GraphQL resolvers (thin)  →  RankingService (application)
                               ├─ LocationResolver ── Geocoder port ── OpenMeteoGeocodingAdapter
                               ├─ ForecastProvider (cache-aside + SWR + single-flight)
                               │     ├─ ForecastRepository port ── MySqlForecastRepository
                               │     └─ WeatherClient port ── OpenMeteoWeatherAdapter (+ Marine API)
                               │            wrapped by ResilientClient decorator (timeout, retry with jitter)
                               └─ ScorerRegistry → SkiScorer | SurfScorer | OutdoorScorer | IndoorScorer (pure)
composition root: src/container.ts (constructor DI, no framework)
```

### Patterns, each with a one-line reason (all recorded in docs/decisions)
- **Strategy + Registry** for scorers: adding an activity is one file (open/closed). Pure functions are easy to test.
- **Ports & Adapters / Repository**: the domain is independent of MySQL and Open-Meteo, and tests use in-memory fakes.
- **Anti-corruption layer**: Open-Meteo's column-shaped JSON maps to the domain `DailyWeather[]` in exactly one place.
- **Decorator** for resilience (timeout, retry): keeps those concerns out of the adapters and business logic.
- **Cache-aside + stale-while-revalidate + single-flight**: fast reads, bounded staleness, and no upstream stampede.
- **Constructor DI with a composition root**: explicit wiring, so swapping in a fake is trivial.
- Rejected: CQRS/event sourcing, a DI framework, microservices, Redis (not needed for a single instance; noted as the scale-out path).

## Domain and scoring
- Inputs from the forecast API (daily, `timezone=auto`, 7 days): weather_code, temperature_2m_max/min, precipitation_sum, precipitation_probability_max, snowfall_sum, wind_speed_10m_max, wind_gusts_10m_max, sunshine_duration, uv_index_max. Hourly `snow_depth` is aggregated to a daily max.
- Marine API (daily): wave_height_max, wave_period_max, swell_wave_height_max. If it returns no data, surfing is `NOT_APPLICABLE`.
- Each scorer returns `{ score 0–100 | null, reasons: string[] }`. It starts from 100 and applies explicit, named penalties and bonuses. **Thresholds live in `config/scoring.ts`** (configurable, with the reasons documented).
  - Skiing: snow depth and fresh snowfall, cold temperatures, low wind and gusts, visibility from weather_code. Elevation from geocoding acts as a soft signal.
  - Surfing: wave height in a 1–2.5m sweet spot, wave period ≥ 8s, wind penalty.
  - Outdoor: comfort band 15–25°C, precipitation probability and amount, wind, sunshine bonus, extreme UV penalty.
  - Indoor: high baseline, plus a boost when outdoor conditions are poor.
- Weekly ranking: weeklyScore = average of the top 3 days (rewards having *some* great days). Activities are ranked by weeklyScore, and each one reports its bestDay. Write this up as an assumption.

## Persistence (MySQL)
- `locations`: id, name, country_code, admin1, lat, lon, elevation, timezone, `grid_key` (lat/lon rounded to 0.1°, unique), created_at.
- `geocode_queries`: normalised_query (+country) → location_id, created_at. Long TTL (30 days), so repeat lookups skip the geocoding API.
- `forecast_snapshots`: id, grid_key, source (`forecast`|`marine`), fetched_at, expires_at, status.
- `daily_forecasts`: snapshot_id, date, the weather columns above (marine columns nullable). PK (snapshot_id, date).
- Reads use the latest snapshot per grid_key. Old snapshots are pruned by a small job (or noted as cut).
- Scores are **not stored**. They're computed at read time, so a scoring change needs no backfill.

## Refresh policy
- Fresh if age < `FORECAST_TTL` (default 3h, matching how often Open-Meteo updates).
- Stale but < `MAX_STALE` (24h): return it with `isStale: true` and trigger a background refresh.
- Missing, or older than MAX_STALE: fetch synchronously.
- An in-process single-flight map keyed by grid_key. Multi-instance option (ADR): MySQL `GET_LOCK()` or Redis.
- If upstream fails and stale data exists: serve it with `isStale`. Otherwise return `ForecastUnavailable`.

## GraphQL schema (summary)
```graphql
type Query { activityRankings(input: RankingInput!): RankingResult! }
input RankingInput { city: String!, countryCode: String }
union RankingResult = ActivityRankings | LocationNotFound | ForecastUnavailable | InvalidInput
type ActivityRankings { location: Location!, forecastFetchedAt: DateTime!, isStale: Boolean!, activities: [ActivityRanking!]! }
type ActivityRanking { activity: Activity!, rank: Int!, weeklyScore: Float, applicable: Boolean!, bestDay: Date, days: [DayScore!]! }
type DayScore { date: Date!, score: Int, rating: Rating, reasons: [String!]! }
enum Activity { SKIING SURFING OUTDOOR_SIGHTSEEING INDOOR_SIGHTSEEING }
enum Rating { EXCELLENT GOOD FAIR POOR NOT_APPLICABLE }
```

## Errors, observability, security
- Domain errors live in `src/domain/errors.ts`. Expected errors become union members. Unexpected errors pass through Apollo `formatError` and come out as `INTERNAL_SERVER_ERROR` with a requestId, no stack trace, logged at error level.
- pino child logger per request (`requestId` from the `x-request-id` header or a generated uuid, plus operationName and durationMs). Secrets redacted.
- `/metrics`: http/graphql latency histogram, cache_result{hit,stale,miss}, upstream_request_duration{api,status}, upstream_errors, single-flight dedup counter.
- `/healthz` (process up) and `/readyz` (MySQL ping).
- Security: helmet, express-rate-limit per IP, depth limit 6, introspection off in production, body size limit, zod input (city 1–100 chars, Unicode letters, spaces, `-'.`), no secrets in the repo (`.env.example`).
- Graceful shutdown on SIGTERM: stop accepting requests, drain, close the pool.

## Repo layout
```
src/
  config/ (env.ts zod, scoring.ts)
  domain/ (types.ts, errors.ts, scoring/{ski,surf,outdoor,indoor,registry,aggregate}.ts)
  application/ (ranking-service.ts, forecast-provider.ts, single-flight.ts, clock.ts)
  infrastructure/ (open-meteo/{geocoding,weather,marine,mappers}.ts, http/resilient-client.ts, db/{prisma-client,repositories}.ts)
  graphql/ (schema.graphql, resolvers.ts, error-format.ts, plugins/logging.ts)
  observability/ (logger.ts, metrics.ts)
  container.ts, server.ts, index.ts
prisma/ schema.prisma + migrations/
test/ unit/, integration/, fixtures/ (recorded Open-Meteo responses)
load/ k6 scripts + mock-upstream server
docs/ decisions/ADR-00x-*.md, questions-and-assumptions.md, ai-log.md, worklog.md, load-testing.md
```

## Process evidence (graded first)
- `docs/questions-and-assumptions.md`: the PM question table (ambiguous city, what "rank" means, skiing without slopes, inland surfing, indoor semantics, timezone, units, weekly aggregation).
- `docs/decisions/`: short ADRs (storage = MySQL, Prisma, Jest, Zod, SWR caching, scores computed at read time, result unions, no tenancy, mock upstream for load tests).
- `docs/ai-log.md`: key prompts, plus what was accepted, changed or rejected.
- `docs/worklog.md`: dated, unpolished notes, including cuts and the reasons for them.
- One small commit per milestone, with clear messages.

## Milestones (one or more commits each)
1. Scaffold: tsconfig strict, ESLint/Prettier, Jest (ts-jest), docker-compose MySQL, CI workflow, docs skeleton with the assumptions.
2. Domain: types, scorers + registry + aggregation, table-driven unit tests with Jest `test.each` (TDD).
3. Open-Meteo adapters + mappers + resilient client, with fixture-based tests.
4. MySQL schema/migrations + repositories, with Testcontainers integration tests.
5. ForecastProvider (SWR + single-flight) + RankingService, with unit tests using a fake clock and fake repo.
6. GraphQL layer, error unions, logging/metrics/health, security middleware, and e2e integration tests.
7. Load tests: a mock upstream + k6 scenarios (warm, cold stampede, mixed), with results in docs/load-testing.md.
8. README (what, how to run, assumptions, trade-offs, cuts, what I'd do next) and a final pass.

## Verification
- `npm run lint && npm run typecheck && npm test` (unit + integration) pass, with a coverage threshold of about 85% on domain/application.
- `docker compose up` → open `http://localhost:4000/graphql` and query `activityRankings(input:{city:"Chamonix"})`. Surfing should be NOT_APPLICABLE and skiing should score sensibly. "Biarritz" should give surfing scores. A nonsense city should return `LocationNotFound`.
- Querying the same city twice: the second call is a cache hit (visible in logs and `/metrics`).
- Stop the mock upstream → the stale response comes back with `isStale: true`.
- `k6 run load/scenarios.js` against the mock upstream: a p95 target (e.g. <150ms warm), and the cold stampede produces 1 upstream call per city.
