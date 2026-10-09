# ADR-002: Hexagonal-lite layering

**Status:** accepted

## Decision

Four layers, with dependencies pointing inwards:

- **domain**: pure types and scoring (no I/O, no frameworks).
- **application**: use cases (`RankingService`, `ForecastProvider`) that depend on _ports_ (interfaces).
- **infrastructure**: adapters that implement the ports (Open-Meteo HTTP, Prisma/MySQL).
- **interface**: GraphQL/Express, kept thin.

Wiring happens in one composition root using constructor injection, with no DI framework.

## Patterns and why

| Pattern                           | Where                   | Why                                                                               |
| --------------------------------- | ----------------------- | --------------------------------------------------------------------------------- |
| Strategy + Registry               | one scorer per activity | Adding an activity is one new file. Scorers are pure, so they're trivial to test. |
| Ports & Adapters / Repository     | DB + weather provider   | The domain doesn't know about MySQL or Open-Meteo, and tests use in-memory fakes. |
| Anti-corruption layer             | Open-Meteo mappers      | The vendor's column-shaped JSON is translated once, at the edge.                  |
| Decorator                         | HTTP resilience         | Timeout and retry wrap the client without cluttering the adapters.                |
| Composition root + constructor DI | `index.ts`              | Explicit wiring with no magic, and fakes are easy to swap in.                     |

## Rejected

CQRS / event sourcing, microservices and a DI container: each adds complexity without a matching problem at this size.

## Code layout (revised 2026-10-09)

Reusable infrastructure that knows nothing about weather lives in `src/modules/`, one folder per module, each
with an `index.ts` as its public API (code outside a module imports only from that index):

| Module              | Contents                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `modules/http`      | `JsonHttpClient` port, `AxiosJsonClient` (timeout + failure classification), `RetryingJsonClient` decorator |
| `modules/database`  | Prisma client over the MariaDB driver adapter, explicit pool size, readiness ping                           |
| `modules/logger`    | pino logger with redaction; AsyncLocalStorage request context stamped on every log line                     |
| `modules/errors`    | `AppError` taxonomy and the single error policy (`mapError`)                                                |
| `modules/express`   | Request ids, the response envelope, the central error middleware                                            |
| `modules/lifecycle` | Graceful shutdown and crash handling                                                                        |

Business code stays in `domain/`, `application/`, `graphql/` and `infrastructure/` (Open-Meteo adapters,
Prisma repositories). The test tree mirrors this layout.
