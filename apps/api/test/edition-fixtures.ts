import { CAPABILITIES } from "@hackos/shared/capabilities";
import { pool } from "../src/db/pool.js";
import { assignRole, asUser, createRole, createUser } from "./helpers.js";

/** Shared edition fixtures for project and sponsor isolation tests (H8). */
export function scoped(userId: number, edition?: string): Record<string, string> {
  return { ...asUser(userId), ...(edition ? { "x-edition": edition } : {}) };
}

export async function setup() {
  await pool.query("INSERT INTO event_config (id, event_key, name) VALUES (1, 'e2026', 'E2026')");
  await pool.query(
    `INSERT INTO editions (event_key, name, status, closed_at) VALUES
       ('e2', 'E2', 'active', NULL), ('old', 'Old', 'active', NULL)`,
  );
  const admin = await createUser();
  const roleId = await createRole([CAPABILITIES.ADMIN_ALL], { isProtected: true });
  await assignRole(admin, roleId);
  return { admin };
}

/** Seed a past edition while it is open, then close it (read-only). */
export async function closeOld(): Promise<void> {
  await pool.query(
    "UPDATE editions SET status = 'closed', closed_at = now() WHERE event_key = 'old'",
  );
}
