/**
 * Dedicated worker entrypoint for production deploys (docker: run
 * `node dist/src/worker.js` in its own container). Registers every module's
 * processors, then starts BullMQ workers — no HTTP listener.
 */
import { pool } from "./db/pool.js";
import { startWorkers, stopQueues } from "./lib/queues.js";
import { closeValkey } from "./lib/valkey.js";

// Importing the module registry has the side effect of registering
// processors. Modules must call registerWorker() at import time.
await import("./modules/index.js");

startWorkers();
console.log("hackOS worker running");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await stopQueues();
    await closeValkey();
    await pool.end();
    process.exit(0);
  });
}
