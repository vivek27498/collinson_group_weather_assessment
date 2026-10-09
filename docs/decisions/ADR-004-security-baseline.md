# ADR-004: Security baseline (SQL injection and related risks)

**Status:** accepted

Defence in depth: no single layer is trusted on its own.

1. **Parameterised queries only.** All DB access goes through Prisma, which binds values as parameters.
   Raw SQL is allowed only through the tagged templates `$queryRaw` and `Prisma.sql`, which are parameterised as well.
2. **Enforced by lint.** `$queryRawUnsafe`, `$executeRawUnsafe` and `Prisma.raw` are banned in
   `eslint.config.mjs`, so `npm run lint` fails if anyone uses them. Verified with a test file: all three were rejected.
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
7. **HTTP hardening.** helmet headers, `x-powered-by` off and a 10 kb body limit.
   - For /graphql: a max-root-fields rule (blocks alias amplification), a depth limit, no batching,
     introspection off in production, and Apollo CSRF prevention.
   - **Per-IP rate limiting was removed** (2026-10-09) to keep the service focused. In production it belongs at
     the gateway or load balancer, which sees every instance's traffic.
8. **Supply chain.** Dependabot watches npm dependencies, and `npm audit --omit=dev` is run before releases.
   **Open advisories (2026-10-09):** the `mariadb` connector (used by Prisma 7's MySQL adapter) has high-severity
   advisories with no fix released yet. Checked against our usage, the only relevant one is a credential leak
   to a man-in-the-middle _despite_ TLS. The mitigation is keeping MySQL on a private network; the others
   (big5/gbk/sjis charsets, NO_BACKSLASH_ESCAPES, SET expansion, GeoJSON, ed25519) don't apply to our
   configuration. Action: upgrade as soon as a patched connector ships.
9. **DB connection auth.** MySQL 8's default `caching_sha2_password` needs either TLS or RSA public key
   retrieval on first connect. Dev/compose use `allowPublicKeyRetrieval=true` (private network).
   Production should use TLS (`?ssl=true`) instead, because key retrieval without TLS is open to a
   man-in-the-middle swapping the key. Found by the Testcontainers tests: the local dev DB had only
   worked because the server had cached the app user's credentials from an earlier CLI login.
10. **Container.** A multi-stage image with production dependencies only, running as the non-root `node` user.

Tests with injection payloads (`'; DROP TABLE locations;--`, `Paris' OR '1'='1`, XSS, log injection,
path traversal) are in `test/unit/services/ranking-input.test.ts` and the GraphQL integration tests.
They assert that the input is rejected before any provider call.
