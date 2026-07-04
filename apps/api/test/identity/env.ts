/**
 * MUST be the first import of every test/identity/*.test.ts file.
 *
 * Parallel workstream suites share the single local Valkey (6379) and each
 * calls `valkey.flushdb()` in beforeEach — running two suites at once lets a
 * sibling's flush wipe this suite's rate-limit counters and capability cache
 * MID-TEST (observed as rare flakes in H3/H8 assertions). Redis logical DBs
 * are flush-isolated (FLUSHDB only clears the selected DB), so the identity
 * suite claims its own index. config.ts reads VALKEY_URL when it is first
 * imported, which happens strictly after this module because ESM evaluates
 * imports in order and app code is only imported lazily inside tests.
 */
process.env.VALKEY_URL = process.env.TEST_VALKEY_URL ?? "redis://localhost:6379/11";
