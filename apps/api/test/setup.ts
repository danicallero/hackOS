/**
 * Per-worker test env. Runs before any application import, so config.ts
 * picks these up. Import app code lazily inside tests/helpers, never at the
 * top of this file.
 */
import { TEST_DATABASE_URL } from "./test-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.WORKERS_INLINE = "false";

// Isolate concurrent test publishers from dev/load and other shards (#897).
process.env.SSE_NAMESPACE = `test-${process.pid}`;

const concurrentPgClientQueryWarning =
  "Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0.";

function failOnConcurrentPgClientQueryWarning(warning: Error): void {
  if (
    warning.name === "DeprecationWarning" &&
    warning.message.startsWith(concurrentPgClientQueryWarning)
  ) {
    throw warning;
  }
}

// Vitest may evaluate setup files more than once in a worker; install one
// listener so this specific pg deprecation fails the owning test.
if (
  !process
    .listeners("warning")
    .some((listener) => listener.name === "failOnConcurrentPgClientQueryWarning")
) {
  process.on("warning", failOnConcurrentPgClientQueryWarning);
}
