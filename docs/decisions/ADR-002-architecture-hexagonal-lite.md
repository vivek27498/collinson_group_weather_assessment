# ADR-002: Hexagonal-lite layering

**Status:** accepted (folder names simplified on 2026-10-09; see "Code layout")

## Decision

Four layers, with dependencies pointing inwards:

- **Scoring** (`src/scoring/`, `src/types.ts`): pure types and scoring rules, with no I/O and no frameworks.
- **Services** (`src/services/`): the use cases (`RankingService`, `ForecastService`). They depend only on
  the interfaces in `services/interfaces.ts`, which are the "ports".
- **Providers and repositories** (`src/providers/`, `src/repositories/`): implement those interfaces
  (Open-Meteo over HTTP, MySQL through Prisma). These are the "adapters".
- **API** (`src/graphql/`, `src/app.ts`): GraphQL and Express, kept thin.

All the wiring happens in one place (`create-services.ts`, called from `index.ts`) using constructor injection,
with no DI framework.

## Patterns and why

| Pattern                           | Where                            | Why                                                                                   |
| --------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------- |
| Strategy + Registry               | one scorer per activity          | Adding an activity is one new file. Scorers are pure, so they're trivial to test.     |
| Ports & Adapters / Repository     | DB + weather provider            | Scoring and services don't know about MySQL or Open-Meteo; tests use in-memory fakes. |
| Anti-corruption layer             | Open-Meteo providers             | The vendor's column-shaped JSON is converted and validated once, at the edge.         |
| Decorator                         | HTTP retries, geocoding cache    | Retries and caching wrap a class without changing it.                                 |
| Composition root + constructor DI | `index.ts`, `create-services.ts` | Explicit wiring with no magic, and fakes are easy to swap in.                         |

## Rejected

CQRS / event sourcing, microservices and a DI container: each adds complexity without a matching problem at this size.

## Code layout (revised 2026-10-09)

The folders were renamed so their names say what they hold, rather than using architecture terms.

| Folder                      | Contents                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `src/types.ts`              | Shared data types (weather, scores, places)                                                  |
| `src/scoring/`              | Ranking, scoring helpers, weather codes; `scorers/` holds one scorer per activity            |
| `src/services/`             | Use cases grouped by feature: `ranking/`, `location/`, `forecast/`; shared `interfaces.ts`   |
| `src/utils/`                | Small generic helpers: `clock.ts`, `request-deduplicator.ts`                                 |
| `src/providers/open-meteo/` | Open-Meteo geocoding, forecast and marine clients                                            |
| `src/repositories/`         | MySQL storage through Prisma                                                                 |
| `src/graphql/`              | Schema, resolvers, Apollo setup, error formatting                                            |
| `src/config/`               | Environment variables and scoring thresholds (the `ScoringConfig` type sits with its values) |
| `src/modules/`              | Reusable code with no weather knowledge (below)                                              |

Each folder in `src/modules/` has an `index.ts` as its public API (code outside a module imports only from that index):

| Module              | Contents                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------- |
| `modules/http`      | `JsonHttpClient` interface, `AxiosJsonClient` (timeout + failure types), `RetryingJsonClient` |
| `modules/database`  | Prisma client over the MariaDB driver, explicit pool size, readiness ping                     |
| `modules/logger`    | pino logger with redaction; the request id added to every log line                            |
| `modules/errors`    | `AppError` classes and the single error policy (`mapError`)                                   |
| `modules/express`   | Request ids, the standard response format, the central error middleware                       |
| `modules/lifecycle` | Graceful shutdown and crash handling                                                          |

The test tree mirrors this layout.
