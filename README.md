# Weather Activity Ranking

A GraphQL service: give it a city or town, and it ranks how good the next 7 days are for **skiing,
surfing, outdoor sightseeing and indoor sightseeing**, with a reason for every score. Weather comes
from [Open-Meteo](https://open-meteo.com) and is persisted in MySQL, not fetched on every request.

> **How I worked** matters more than this README. Start with [docs/worklog.md](docs/worklog.md)
> (dated notes, including what broke and why), [docs/ai-log.md](docs/ai-log.md) (where I steered or
> overruled the AI), [docs/questions-and-assumptions.md](docs/questions-and-assumptions.md) (PM questions
> and the assumption I committed to) and [docs/decisions/](docs/decisions/) (ADRs).

## Try it

```graphql
query Rank($input: RankingInput!) {
  activityRankings(input: $input) {
    ... on ActivityRankings {
      location {
        name
        country
      }
      isStale
      activities {
        rank
        activity
        weeklyScore
        weeklyRating
        bestDay
        days {
          date
          score
          reasons
        }
      }
    }
    ... on LocationNotFound {
      message
    }
    ... on InvalidInput {
      fieldErrors {
        field
        message
      }
    }
  }
}
```

with variables (the standard way to pass inputs: the query text stays fixed, only the values change):

```json
{ "input": { "city": "Chamonix" } }
```

As curl: [docs/manual-testing.md#6-curl-cheat-sheet](docs/manual-testing.md#6-curl-cheat-sheet).

```jsonc
// abridged
{
  "rank": 3,
  "activity": "SKIING",
  "weeklyScore": 29.7,
  "weeklyRating": "POOR",
  "bestDay": "2026-10-09",
  "days": [
    {
      "date": "2026-10-07",
      "score": 10,
      "reasons": ["Thin snow cover (0 cm) (-60)", "Warm, slushy snow (max 7.4°C) (-30)"],
    },
  ],
}
```

A Postman collection with one folder per use case (22 requests, 58 assertions) is in [postman/](postman/).
See [docs/manual-testing.md](docs/manual-testing.md), which also shows how to simulate outages.

## Run it

**Everything in Docker** (MySQL → migrations as a DDL user → app as a DML-only user):

```bash
docker compose up -d --build        # http://localhost:4000/graphql
```

**Locally** (Node 22, Docker for MySQL):

```bash
npm ci && cp .env.example .env
docker compose up -d mysql          # MySQL on :3307 with least-privilege users
npx prisma migrate deploy           # runs as the migrator user
npm run dev
```

| Command                                       | What                                                                |
| --------------------------------------------- | ------------------------------------------------------------------- |
| `npm test`                                    | Unit + integration (integration needs Docker: Testcontainers MySQL) |
| `npm run test:cov`                            | All tests with an 85% coverage gate                                 |
| `npm run lint` / `typecheck` / `format:check` | Static checks                                                       |
| `npx newman run postman/*.json`               | The Postman collection from the CLI                                 |

Endpoints: `POST /graphql`, `GET /healthz` (liveness), `GET /readyz` (DB + draining).

## What's in it

| Business use case                        | How                                                                                                                         |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Rank the week, pick the day, explain why | Explainable rule-based scorers (start at 100, named adjustments); weekly score = mean of best 3 days                        |
| Not possible here                        | Surfing inland is `NOT_APPLICABLE` with a reason, not 0                                                                     |
| Bad-weather fallback                     | Indoor builds on the outdoor score, so it wins on wet days                                                                  |
| Ambiguous names ("Paris")                | Resolved location + same-name `alternatives`; `countryCode` disambiguates                                                   |
| Unknown place / bad input                | `LocationNotFound` / `InvalidInput` union members: data, not errors                                                         |
| Provider slow or down                    | Cache with stale-while-revalidate; serves `isStale: true` data instead of failing; marine-only outages degrade just surfing |

**Architecture.** Hexagonal-lite: pure **scoring** rules, **services** that only talk to interfaces,
**providers** (Open-Meteo) and **repositories** (MySQL) that implement those interfaces, and a thin
GraphQL layer. Everything is wired by constructor injection in one place (`create-services.ts`). Patterns used
where they earn their place: Strategy + Registry (scorers), Decorator (`RetryingJsonClient(AxiosJsonClient)`,
`DbFirstGeocoder`), Repository, and Zod validation of every Open-Meteo response.
([ADR-002](docs/decisions/ADR-002-architecture-hexagonal-lite.md))

**Code layout.** Folder names say what they hold:

```
src/
  index.ts, create-services.ts, app.ts   start-up, wiring, Express app
  types.ts                         shared data types
  scoring/                         ranking + scoring helpers (pure functions)
    scorers/                       one scorer per activity: ski, surf, outdoor, indoor
  services/                        the use cases, grouped by feature (+ interfaces.ts)
    ranking/                       RankingService + input validation
    location/                      DbFirstGeocoder (find a place: database first, then Open-Meteo)
    forecast/                      ForecastService (weather: saved data first, then Open-Meteo)
  utils/                           small generic helpers: clock, request deduplicator
  providers/open-meteo/            Open-Meteo geocoding, forecast and marine clients
  repositories/                    MySQL storage through Prisma
  graphql/                         schema, resolvers, Apollo setup
  config/                          environment variables and scoring thresholds
  modules/                         reusable code with no weather knowledge:
                                   http (axios + retries), database (Prisma + pool), logger,
                                   errors, express helpers, lifecycle (graceful shutdown)
```

**Persistence and refresh.** Forecasts are cached per ~11 km grid cell in MySQL. Fresh for 3 h, served
stale up to 24 h while refreshing in the background, and single-flighted so 200 concurrent requests for a
new city make **1** upstream call. Geocoding is cached for 30 days, and "not found" for
1 day. Scores are never stored, so retuning needs no backfill. ([ADR-003](docs/decisions/ADR-003-caching-swr.md))

**Errors, security, ops.**

- One error policy for REST and GraphQL: no stack traces or internals leak.
- Input is checked against an allow-list, and only parameterised SQL is allowed (enforced by lint).
- Least-privilege DB users, and GraphQL limits on query depth, root fields and batching.
- Graceful shutdown, and request-id-correlated JSON logs that say whether data came from the cache or live.
- Details in [ADR-004](docs/decisions/ADR-004-security-baseline.md) and [ADR-005](docs/decisions/ADR-005-error-and-response-handling.md).

## Assumptions (the important ones)

Full list with reasoning: [docs/questions-and-assumptions.md](docs/questions-and-assumptions.md).

- "Paris" → the top geocoding match (population-ranked); the response says which place was chosen.
- Weather can't tell us whether a ski resort exists: skiing scores _weather suitability_, using elevation as a soft signal.
- Days are local calendar days for the place (`timezone=auto`). Units are metric.
- Scoring thresholds are judgement calls, kept in [src/config/scoring.ts](src/config/scoring.ts) and covered by tests.
- No auth or multi-tenancy (out of scope; weather isn't tenant data).

## Testing

- **338 tests**, 99% line coverage across the full suite:
  - Table-driven unit tests for the scoring rules.
  - Cache behaviour with a fake clock (fresh, stale, expired, stampede, outages).
  - Recorded real Open-Meteo payloads for the adapters.
  - GraphQL end-to-end through the real object graph, with `nock`.
  - Prisma adapters against a **real MySQL 8.4** via Testcontainers.
- **Bugs found by verifying for real** rather than trusting green unit tests (details in the worklog):
  - MySQL 8 auth failing on a fresh server.
  - An upstream timeout tuned below real latency.
  - Apollo's own signal handlers forcing exit 1 on `docker stop`.
  - Missing single-flight on geocoding (found by a load test, since removed from the repo).

## Cut, or next

- **Not built, by choice:** multi-tenancy, auth, a UI, hourly scoring, wind direction and tides for surfing, and a ski-resort dataset.
- **Cut to keep the submission focused:** Prometheus metrics, per-IP rate limiting, the CI workflow and the k6 load tests.
  The history and findings are in the worklog. Rate limiting belongs at the gateway in production.
- **Next:**
  1. An in-process L1 cache in front of MySQL.
  2. A distributed lock (MySQL `GET_LOCK`/Redis) so single-flight holds across instances.
  3. Upgrade the `mariadb` connector once the open advisories are fixed (see ADR-004).
- **Open product question:** indoor sightseeing rates EXCELLENT even in sunny weeks (PM question #13).
