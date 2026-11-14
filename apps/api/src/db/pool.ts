import client from "@prometheus-io/client";
import pg from "pg";
import { config } from "../config.js";
import { editionSessionSettings } from "../lib/edition.js";
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

const APPLY_EDITION_SQL =
  "SELECT set_config('hackos.edition', $1, $3), set_config('hackos.edition_write_override', $2, $3)";

/**
 * Multi-edition scope (lib/edition.ts): a request that views a non-current
 * edition, or that may write into a closed one, runs each pooled statement on
 * a connection carrying `hackos.edition` / `hackos.edition_write_override`,
 * which `current_edition()` and the edition write guard read. The settings
 * are reset before the connection returns to the pool; if the reset fails
 * the connection is destroyed rather than reused with a foreign scope.
 * Requests on the current edition take the untouched fast path.
 */
const unscopedQuery = pool.query.bind(pool) as (...args: unknown[]) => Promise<unknown>;
pool.query = ((...args: unknown[]) => {
  const scope = editionSessionSettings();
  if (!scope || typeof args[args.length - 1] === "function") return unscopedQuery(...args);
  return (async () => {
    const client = await pool.connect();
    let releaseError: Error | undefined;
    try {
      await client.query(APPLY_EDITION_SQL, [
        scope.edition ?? "",
        scope.writeOverride ? "on" : "",
        false,
      ]);
      return await (client.query as (...a: unknown[]) => Promise<unknown>)(...args);
    } finally {
      try {
        await client.query(APPLY_EDITION_SQL, ["", "", false]);
      } catch (err) {
        releaseError = err as Error;
      }
      client.release(releaseError);
    }
  })();
}) as typeof pool.query;

// Saturation gauges (#540): pull-based off the pool's own live counters, no
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
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
  options: { snapshotRead?: boolean } = {},
): Promise<T> {
  const endWait = dbPoolWaitSeconds.startTimer();
  const client = await pool.connect();
  endWait();
  try {
    // `snapshotRead`: one repeatable-read, read-only snapshot for the whole
    // callback. The isolation level must be set by BEGIN: a later SET
    // TRANSACTION is rejected once the edition scope below has run a query.
    await client.query(
      options.snapshotRead ? "BEGIN ISOLATION LEVEL REPEATABLE READ, READ ONLY" : "BEGIN",
    );
    // Transaction-local edition scope (lib/edition.ts); ends with the transaction.
    const scope = editionSessionSettings();
    if (scope) {
      await client.query(APPLY_EDITION_SQL, [
        scope.edition ?? "",
        scope.writeOverride ? "on" : "",
        true,
      ]);
    }
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
