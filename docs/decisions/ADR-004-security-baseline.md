# ADR-004: Security baseline (SQL injection and related risks)

**Status:** accepted

Defence in depth: no single layer is trusted on its own.

1. **Parameterised queries only.** All DB access goes through Prisma, which binds values as parameters.
   Raw SQL is allowed only through the tagged templates `$queryRaw` and `Prisma.sql`, which are parameterised as well.
2. **Enforced by lint.** `$queryRawUnsafe`, `$executeRawUnsafe` and `Prisma.raw` are banned in
   `eslint.config.mjs`, so CI fails if anyone uses them. Verified with a test file: all three were rejected.
3. **Validate at the edge.** GraphQL types are checked first, then Zod allow-lists the input: a city is 1–100
   characters of letters, spaces and `-'.`, and a `countryCode` must match `^[A-Z]{2}$`. Input is normalised
   before it's used as a cache key.
4. **Least-privilege DB users** (`docker/mysql/init/01-users.sh`). The service connects as `app`, which can only
   SELECT/INSERT/UPDATE/DELETE, and migrations run as `migrator`. An injection that somehow got through still
   couldn't `DROP` or `ALTER` anything.
5. **Outbound URLs** are built with `URL`/`URLSearchParams`, and upstream hosts come from config, never from
   user input (so no SSRF).
6. **No leaks.**
   - Unexpected errors become a generic 500 (`error-mapper.ts`).
   - Secrets are redacted in logs.
   - Config errors name the bad variable but never echo its value.
   - Caller-supplied request IDs are validated to prevent log injection.
7. **HTTP hardening.** helmet headers, `x-powered-by` off and a 10 kb body limit. Rate limiting, GraphQL
   depth limits and turning introspection off in production arrive with the GraphQL layer (M6).
8. **Supply chain.** `npm audit` runs on production dependencies in CI, and Dependabot covers npm and Actions.
9. **Container.** A multi-stage image with production dependencies only, running as the non-root `node` user.

Tests with injection payloads (`'; DROP TABLE locations;--`, `Paris' OR '1'='1`) come with the input
layer (M6). They assert that the tables still exist afterwards.
