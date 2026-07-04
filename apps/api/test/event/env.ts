/**
 * MUST be the first import of every test/event/*.test.ts file. Claims its own
 * flush-isolated Valkey logical DB (see test/queue/env.ts).
 */
process.env.VALKEY_URL = process.env.TEST_VALKEY_URL ?? "redis://localhost:6379/8";
