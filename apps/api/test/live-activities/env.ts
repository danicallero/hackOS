/**
 * MUST be the first import of every test/live-activities/*.test.ts file.
 * Claims its own Valkey logical DB (5) so a sibling suite's flushdb can't
 * wipe this suite's state mid-test — see test/queue/env.ts.
 */
process.env.VALKEY_URL = process.env.TEST_VALKEY_URL ?? "redis://localhost:6379/5";
