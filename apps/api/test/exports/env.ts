/**
 * MUST be the first import of every test/exports/*.test.ts file. See
 * test/queue/env.ts for why each parallel-workstream suite claims its own
 * Valkey logical DB index. This suite claims 15 (next free after 7-14).
 */
process.env.VALKEY_URL = process.env.TEST_VALKEY_URL ?? "redis://localhost:6379/15";
