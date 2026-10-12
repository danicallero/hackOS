/**
 * MUST be the first import of every test/diary/*.test.ts file. Claims its own
 * flush-isolated Valkey logical DB for the scan rate-limit counters (see
 * test/identity/env.ts).
 */
process.env.VALKEY_URL = process.env.TEST_VALKEY_URL ?? "redis://localhost:6379/6";
