import pg from "pg";
import client from "prom-client";
import { config } from "../config.js";
import { register } from "../lib/metrics.js";

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: config.dbPoolMax,
  idleTimeoutMillis: config.DB_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: config.DB_CONNECTION_TIMEOUT_MS,
  statement_timeout: config.DB_STATEMENT_TIMEOUT_MS,
  idle_in_transaction_session_timeout: config.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
});

export type Queryable = pg.Pool | pg.PoolClient;

// Saturation gauges (H540): pull-based off the pool's own live counters, no
// polling loop needed. totalCount includes idle + checked-out connections.
new client.Gauge({
  name: "hackos_db_pool_total",
  help: "Total connections currently held by the pg pool (idle + in use)",
  registers: [register],
  collect() {
    this.set(pool.totalCount);
  },
});
new client.Gauge({
  name: "hackos_db_pool_idle",
  help: "Idle connections currently held by the pg pool",
  registers: [register],
  collect() {
    this.set(pool.idleCount);
  },
});
new client.Gauge({
  name: "hackos_db_pool_waiting",
  help: "Pending pool.connect() calls waiting for a free connection",
  registers: [register],
  collect() {
    this.set(pool.waitingCount);
  },
});

const dbPoolWaitSeconds = new client.Histogram({
  name: "hackos_db_pool_wait_seconds",
  help: "Time spent waiting for withTransaction() to acquire a pooled connection",
  registers: [register],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 10],
});

/**
 * Run `fn` inside a transaction. Rolls back on throw. Domain invariants that
 * span rows (queue transitions, badge rotation, spot confirmation) must go
 * through this so their history/audit rows commit atomically (plan/07 §2).
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const endWait = dbPoolWaitSeconds.startTimer();
  const client = await pool.connect();
  endWait();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
