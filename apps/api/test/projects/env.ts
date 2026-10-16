/**
 * H19/H20: projects use a flush-isolated Valkey DB, like the other domain suites.
 * Root-level tests run in another shard and FLUSHDB would otherwise erase the
 * project's capability cache and SSE counters in the middle of a request.
 * This must be the first import, before config.ts reads VALKEY_URL.
 */
process.env.VALKEY_URL = process.env.TEST_VALKEY_URL ?? "redis://localhost:6379/3";
