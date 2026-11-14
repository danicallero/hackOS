import { migrate } from "../scripts/migrate.js";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { pool } from "./db/pool.js";
import { startWorkers, stopQueues } from "./lib/queues.js";
import { drainAndClose } from "./lib/shutdown.js";
import { closeValkey } from "./lib/valkey.js";

// Keep direct `node dist/server.js` launches safe as well as Compose launches:
// the API must never expose routes against an unapplied schema (H10, H53, H54).
await migrate();
const app = await buildApp();

if (config.workersInline) {
  startWorkers();
}

await app.listen({ port: config.PORT, host: config.HOST });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, "draining before shutdown");
    // Rolling deploys stop the old replica only after its successor is
    // healthy; draining lets its in-flight work finish there (#1327).
    await drainAndClose(app, {
      drainTimeoutMs: config.SHUTDOWN_DRAIN_TIMEOUT_MS,
      sseSpreadMs: config.SSE_DRAIN_SPREAD_MS,
    });
    await stopQueues();
    await closeValkey();
    await pool.end();
    process.exit(0);
  });
}
