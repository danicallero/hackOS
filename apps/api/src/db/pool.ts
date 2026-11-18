import client from "@prometheus-io/client";
import pg from "pg";
import { config } from "../config.js";
import { editionSessionSettings } from "../lib/edition.js";
import { dbGateMetrics, register } from "../lib/metrics.js";
import { RequestAdmission } from "../lib/request-admission.js";
import { getRequestContext } from "../lib/request-context.js";

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: config.dbPoolMax,
  idleTimeoutMillis: config.DB_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: config.DB_CONNECTION_TIMEOUT_MS,
  statement_timeout: config.DB_STATEMENT_TIMEOUT_MS,
  idle_in_transaction_session_timeout: config.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
});

export type Queryable = pg.Pool | pg.PoolClient;

/** pg-pool's own checkout-timeout message; the error handler answers it with 503. */
export const POOL_CONNECT_TIMEOUT_MESSAGE = "timeout exceeded when trying to connect";

/**
 * Lane-aware checkout gate (#544, #1367). pg-pool serves waiters first come,
 * first served, so without this a burst of participant requests would queue
 * ahead of scanners and queue operations for the same connections. The gate
 * has exactly the pool's size, orders waiting checkouts by the request lane
 * (`RequestContext.lane`; work outside a request, such as workers, counts as
 * P1) and keeps a share of connections for P0/P1, like HTTP admission does
 * for requests. That lets HTTP admission admit more requests than there are
 * connections, since requests also wait on things other than Postgres.
 *
 * The gate is re-entrant: a request that already holds a connection and asks
 * for another (a `pool.query` inside a transaction, parallel reads) is served
 * as P0 and may use the reserved share. Otherwise a lock holder that needs a
 * second connection could wait behind the very requests blocked on its lock
 * until the checkout timeout.
 */
const checkoutGate = new RequestAdmission({
  maxConcurrent: config.dbPoolMax,
  // Bounding best-effort work is HTTP admission's job, not the pool's.
  maxBestEffortPending: Number.MAX_SAFE_INTEGER,
  maxWaitMs: config.DB_CONNECTION_TIMEOUT_MS > 0 ? config.DB_CONNECTION_TIMEOUT_MS : undefined,
  waitTimeoutError: () => new Error(POOL_CONNECT_TIMEOUT_MESSAGE),
  metrics: dbGateMetrics,
});

type ConnectCallback = (err: Error | undefined, client?: pg.PoolClient, done?: () => void) => void;
const rawConnect = pool.connect.bind(pool) as () => Promise<pg.PoolClient>;

async function gatedConnect(): Promise<pg.PoolClient> {
  const context = getRequestContext();
  const lane = context?.dbCheckouts ? "P0" : (context?.lane ?? "P1");
  const lease = await checkoutGate.acquire(lane);
  let client: pg.PoolClient;
  try {
    client = await rawConnect();
  } catch (err) {
    lease.release();
    throw err;
  }
  if (context) context.dbCheckouts = (context.dbCheckouts ?? 0) + 1;
  // pg-pool assigns a fresh `release` on every checkout, so wrapping this
  // checkout's function frees the gate slot exactly when the client returns.
  const release = client.release;
  let returned = false;
  client.release = ((...args: Parameters<typeof release>) => {
    if (!returned) {
      returned = true;
      lease.release();
      if (context?.dbCheckouts) context.dbCheckouts--;
    }
    return release.apply(client, args);
  }) as typeof release;
  return client;
}

// pg-pool's own `query()` checks out through `this.connect(callback)`, so the
// override covers the callback form too.
pool.connect = ((callback?: ConnectCallback) => {
  const checkout = gatedConnect();
  if (!callback) return checkout;
  checkout.then(
    (client) => callback(undefined, client, client.release),
    (err: Error) => callback(err),
  );
  return undefined;
}) as typeof pool.connect;

/** Live checkout-gate state, for readiness output (#1367). */
export function checkoutGateHealth() {
  return checkoutGate.health();
}

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
