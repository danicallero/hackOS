/**
 * MUST be the first import of every test/applications/*.test.ts file.
 *
 * Parallel workstream suites share the single local Valkey (6379) and each
 * calls `valkey.flushdb()` in beforeEach — running two suites at once lets a
 * sibling's flush wipe this suite's capability cache MID-TEST (rare flakes in
 * capability-guarded assertions). Redis logical DBs are flush-isolated
 * (FLUSHDB only clears the selected DB), so the applications suite claims its
 * own index (12). config.ts reads VALKEY_URL when it is first imported, which
 * happens strictly after this module because ESM evaluates imports in order
 * and app code is only imported lazily inside tests.
 */
process.env.VALKEY_URL = process.env.VALKEY_URL ?? "redis://localhost:6379/12";
