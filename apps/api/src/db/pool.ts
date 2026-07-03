import pg from "pg";
import { config } from "../config.js";

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: config.isTest ? 5 : 10,
});

export type Queryable = pg.Pool | pg.PoolClient;

/**
 * Run `fn` inside a transaction. Rolls back on throw. Domain invariants that
 * span rows (queue transitions, badge rotation, spot confirmation) must go
 * through this so their history/audit rows commit atomically (plan/07 §2).
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
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
