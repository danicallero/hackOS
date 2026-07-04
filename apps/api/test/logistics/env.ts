/**
 * MUST be the first import of every test/logistics/*.test.ts file.
 *
 * Parallel workstream suites share the single local Valkey (6379) and each
 * calls `valkey.flushdb()` in beforeEach. Redis logical DBs are flush-isolated
 * (FLUSHDB only clears the selected DB), so the logistics suite claims its own
 * index (13) — a sibling suite's flush can't wipe our capability cache
 * mid-test. config.ts reads VALKEY_URL when first imported, which happens
 * strictly after this module because app code is imported lazily inside tests.
 * Mirrors test/identity/env.ts.
 */
process.env.VALKEY_URL = process.env.TEST_VALKEY_URL ?? "redis://localhost:6379/13";
