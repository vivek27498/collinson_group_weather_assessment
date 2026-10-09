# ADR-005: Centralised error policy and response envelope

**Status:** accepted

## Context

Errors will come from many places: validation, the domain, upstream APIs, the DB and the framework.
Without one policy, each handler invents its own status codes and messages, and internal details leak.

## Decision

- **Error taxonomy** (`src/modules/errors/app-error.ts`): `AppError` subclasses carry a transport-agnostic
  `kind` (VALIDATION, NOT_FOUND, ...) and a stable `code` that clients can switch on. Domain code never mentions HTTP.
- **One mapper** (`error-mapper.ts`) turns any thrown value into `{ kind, code, httpStatus, message, logLevel }`.
  - Expected errors are exposed to the client and logged at `warn`, without a stack trace.
  - Everything else becomes a generic 500, logged at `error` with the full stack.
- **One Express error middleware** (`error-handler.ts`) and a `sendSuccess` helper (`respond.ts`) give every
  REST response the same envelope:
  `{ success, data | error: { code, message, details? }, meta: { requestId, timestamp } }`.
- **Express 5** forwards async errors natively, so handlers just `throw`. We considered `express-async-errors`
  and rejected it, because it only patches Express 4.
- GraphQL keeps its spec-defined `{ data, errors }` shape, but Apollo's `formatError`
  (`src/graphql/format-error.ts`) reuses the **same mapper**. Expected domain outcomes (e.g. LocationNotFound) are modelled as **union result types**.

## Consequences

Adding a new error means adding one subclass. Status codes, logging and client wording are all decided in one file.
