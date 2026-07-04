/**
 * MUST be the first import of every test/challenges/*.test.ts file. Claims its
 * own flush-isolated Valkey logical DB so a sibling suite's flushdb can't wipe
 * this suite's capability cache mid-test (see test/queue/env.ts).
 */
process.env.VALKEY_URL = process.env.TEST_VALKEY_URL ?? "redis://localhost:6379/9";
