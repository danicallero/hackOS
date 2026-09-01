import { pool } from "../../src/db/pool.js";
import { ensureApplicationFormVersion, grantAttendeeRole } from "../helpers.js";

let appSeq = 0;

/** Create an activity directly (no activities CRUD in WS-C scope). */
export async function createActivity(
  opts: { category?: string; requiresScan?: boolean; name?: string } = {},
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO activities (name, category, requires_scan) VALUES ($1, $2, $3) RETURNING id`,
    [opts.name ?? "Activity", opts.category ?? "general", opts.requiresScan ?? false],
  );
  return rows[0].id;
}

export async function createMeal(name = "Dinner"): Promise<number> {
  return createActivity({ category: "meal", requiresScan: true, name });
}

/**
 * Issue an entrance ticket for a user; returns the QR token. Also grants the
 * seeded Participant role (H8 full-replacement — identity/role.ts's
 * assignAttendeeRole), mirroring how a real ticket is never issued without
 * some form of event access (confirmed application or a real attendee-role
 * grant) — otherwise wallet-pass issuance would reject it as not currently
 * entitled, and badge/wallet/scanner code would show no role name instead of
 * "Participant".
 */
export async function issueTicket(userId: number, token?: string): Promise<string> {
  const t = token ?? `tkt-${crypto.randomUUID()}`;
  await pool.query(`INSERT INTO tickets (user_id, token) VALUES ($1, $2)`, [userId, t]);
  await grantAttendeeRole(userId, "participant");
  return t;
}

/** Assign a badge directly (bypasses the check-in flow, for presence/meal setup). */
export async function assignBadge(userId: number, badgeId: string): Promise<void> {
  await pool.query(`UPDATE users SET badge_id = $1 WHERE id = $2`, [badgeId, userId]);
}

export async function createIntolerance(
  proposedBy: number,
  label: Record<string, string> = { en: "Gluten", es: "Gluten", gl: "Gluten" },
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO food_intolerances (label, proposed_by) VALUES ($1, $2) RETURNING id`,
    [JSON.stringify(label), proposedBy],
  );
  return rows[0].id;
}

export async function setIntolerances(
  userId: number,
  ids: number[],
  notes?: string,
): Promise<void> {
  await pool.query(
    `UPDATE users SET food_intolerances = $1, food_intolerance_notes = $2 WHERE id = $3`,
    [ids, notes ?? null, userId],
  );
}

/** An active Apple/Google badge pass (H28 hook), voided on rotation. */
export async function createBadgePass(
  userId: number,
  platform: "apple" | "google" = "apple",
): Promise<number> {
  const googleObjectId = platform === "google" ? `test-issuer.badge-${crypto.randomUUID()}` : null;
  const { rows } = await pool.query(
    `INSERT INTO wallet_passes (user_id, purpose, platform, serial_number, authentication_token, google_object_id)
     VALUES ($1, 'badge', $2, $3, $4, $5) RETURNING id`,
    [userId, platform, `sn-${crypto.randomUUID()}`, `at-${crypto.randomUUID()}`, googleObjectId],
  );
  return rows[0].id;
}

/** Mark a user as a confirmed participant (for bulk-grant / lookup tests). */
export async function makeConfirmed(userId: number): Promise<void> {
  appSeq += 1;
  const app = await pool.query(
    `INSERT INTO applications (name, type, template) VALUES ($1, 'participant', '{}'::jsonb) RETURNING id`,
    [`app-${appSeq}-${crypto.randomUUID()}`],
  );
  const formVersionId = await ensureApplicationFormVersion(app.rows[0].id);
  await pool.query(
    `INSERT INTO application_responses
       (user_id, application_id, application_form_version_id, status, confirmed_at)
     VALUES ($1, $2, $3, 'confirmed', now())`,
    [userId, app.rows[0].id, formVersionId],
  );
}
