/**
 * Dedicated worker entrypoint for production deploys (docker: run
 * `node dist/src/worker.js` in its own container). Registers every module's
 * processors, then starts BullMQ workers — no HTTP listener.
 */
import { config } from "./config.js";
import { pool } from "./db/pool.js";
import { startMetricsServer } from "./lib/metrics-server.js";
import { startWorkers, stopQueues } from "./lib/queues.js";
import { closeValkey } from "./lib/valkey.js";

// Importing the module registry has the side effect of registering
// processors. Modules must call registerWorker() at import time.
await import("./modules/index.js");

startWorkers();
const metricsServer = await startMetricsServer();
console.log("hackOS worker running");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    // Last resort if a cleanup step hangs (e.g. a job that never finishes).
    setTimeout(() => process.exit(1), config.SHUTDOWN_DRAIN_TIMEOUT_MS + 5_000).unref();
    let failed = false;
    const step = async (name: string, run: () => Promise<unknown>) => {
      try {
        await run();
      } catch (err) {
        failed = true;
        console.error(`[worker] shutdown step ${name} failed`, err);
      }
    };
    // BullMQ's close waits for active jobs, so a rolling deploy retires this
    // worker without abandoning them; Compose's stop_grace_period bounds the
    // wait, and a job interrupted past it is retried after its lock expires
    // (#1327).
    await step("queues", stopQueues);
    await step("valkey", closeValkey);
    await step("postgres", () => pool.end());
    await step(
      "metrics",
      () => new Promise<void>((resolve) => metricsServer.close(() => resolve())),
    );
    process.exit(failed ? 1 : 0);
  });
}
