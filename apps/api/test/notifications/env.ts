/**
 * MUST be the first import of every test/notifications/*.test.ts file.
 *
 * Parallel workstream suites share the single local Valkey (6379). The
 * capability layer (src/lib/capabilities.ts) caches `caps:<userId>` there with
 * a 30s TTL, and every suite resets its own Postgres DB with identity ids
 * starting at 1 — so on the default logical db a sibling suite caching
 * `caps:1 = []` (its own capability-less user 1) silently strips
 * ANNOUNCEMENTS_MANAGE / AUDIT_READ from OUR user 1 mid-run → intermittent
 * 403s. A sibling's beforeEach `flushdb()` can likewise wipe our cache
 * mid-test. Redis logical DBs are flush-isolated (FLUSHDB clears only the
 * selected db), so this suite claims its own index (10; identity uses 11).
 *
 * config.ts reads VALKEY_URL on first import, which happens strictly after
 * this module: ESM evaluates imports top-to-bottom and app code is only
 * imported lazily inside the tests/helpers.
 */
process.env.VALKEY_URL = process.env.TEST_VALKEY_URL ?? "redis://localhost:6379/10";
