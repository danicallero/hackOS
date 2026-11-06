import client from "@prometheus-io/client";
import { register } from "./metrics.js";

/** Postgres error codes for the two timeouts pool.ts configures (#540). */
const STATEMENT_TIMEOUT_CODE = "57014"; // query_canceled (statement_timeout)
const IDLE_IN_TRANSACTION_TIMEOUT_CODE = "25P03"; // idle_in_transaction_session_timeout

export function isTimeoutError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === STATEMENT_TIMEOUT_CODE || code === IDLE_IN_TRANSACTION_TIMEOUT_CODE;
}

/** Postgres `unique_violation`. */
export const PG_UNIQUE_VIOLATION = "23505";

/** True for a unique-constraint failure, optionally limited to one constraint name. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string } | null;
  if (e?.code !== PG_UNIQUE_VIOLATION) return false;
  return constraint === undefined || e.constraint === constraint;
}

export const dbTimeoutsTotal = new client.Counter({
  name: "hackos_db_query_timeouts_total",
  help: "Queries aborted by statement_timeout or idle_in_transaction_session_timeout",
  registers: [register],
});
