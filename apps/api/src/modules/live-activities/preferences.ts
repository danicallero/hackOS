import { CAPABILITIES } from "@hackos/shared/capabilities";
import type {
  LiveActivityConfigKind,
  MyLiveActivityPreferences,
} from "@hackos/shared/live-activities";
import { pool, type Queryable, withTransaction } from "../../db/pool.js";
import { NotFoundError } from "../../lib/errors.js";
import { LIVE_ACTIVITY_REQUIRED_CAPABILITY } from "./settings.js";

/**
 * A user's own per-kind Live Activity choice (#966; H38, H25, H59, H19, H22).
 * Organizers decide which kinds exist and for whom; the user may then turn
 * off any kind they receive. Stored per user as opt-outs
 * (`live_activity_kind_opt_outs`), which `candidates.ts` drops, so the worker
 * ends running sessions of a turned-off kind and never starts them again.
 */

/**
 * The kinds `userId` may receive, in priority order: enabled, allowed for one
 * of the user's (non-deleted) roles, and with the kind's capability gate
 * (plus event access for the deadline) — the same static gates as
 * `candidatesFor`. Data gates (a queue entry, a schedule audience, an open
 * window) are not applied: the choice holds before the moment arrives.
 */
async function availableKinds(userId: number, db: Queryable): Promise<LiveActivityConfigKind[]> {
  const { rows } = await db.query<{
    kind: LiveActivityConfigKind;
    capabilities: string[] | null;
    event_access: boolean;
  }>(
    `SELECT ks.kind,
            (SELECT array_agg(uec.capability) FROM user_effective_capabilities uec
              WHERE uec.user_id = $1) AS capabilities,
            EXISTS (SELECT 1 FROM user_event_access uea WHERE uea.user_id = $1) AS event_access
       FROM live_activity_kind_settings ks
      WHERE ks.enabled
        AND EXISTS (SELECT 1 FROM user_roles ur
                      JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
                      JOIN live_activity_kind_roles kr ON kr.role_id = r.id
                     WHERE ur.user_id = $1 AND kr.kind = ks.kind)
      ORDER BY ks.priority, ks.kind`,
    [userId],
  );
  return rows
    .filter((row) => {
      const held = new Set(row.capabilities ?? []);
      const required = LIVE_ACTIVITY_REQUIRED_CAPABILITY[row.kind];
      if (required && !held.has(required) && !held.has(CAPABILITIES.ADMIN_ALL)) return false;
      return row.kind !== "deadline" || row.event_access;
    })
    .map((row) => row.kind);
}

export async function readLiveActivityPreferences(
  userId: number,
  db: Queryable = pool,
): Promise<MyLiveActivityPreferences> {
  const kinds = await availableKinds(userId, db);
  const { rows } = await db.query<{ kind: LiveActivityConfigKind }>(
    `SELECT kind FROM live_activity_kind_opt_outs WHERE user_id = $1`,
    [userId],
  );
  const off = new Set(rows.map((row) => row.kind));
  return { kinds: kinds.map((kind) => ({ kind, enabled: !off.has(kind) })) };
}

/**
 * Sets the listed kinds on or off; unlisted kinds keep their choice. A kind
 * the user is not entitled to may be stored too: it is invisible until the
 * entitlement returns, and then it keeps the user's choice.
 */
export async function saveLiveActivityPreferences(
  userId: number,
  changes: { kind: LiveActivityConfigKind; enabled: boolean }[],
): Promise<MyLiveActivityPreferences> {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!rows[0]) throw new NotFoundError("User not found");
    const off = changes.filter((c) => !c.enabled).map((c) => c.kind);
    const on = changes.filter((c) => c.enabled).map((c) => c.kind);
    if (off.length > 0) {
      await client.query(
        `INSERT INTO live_activity_kind_opt_outs (user_id, kind)
         SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`,
        [userId, off],
      );
    }
    if (on.length > 0) {
      await client.query(
        `DELETE FROM live_activity_kind_opt_outs WHERE user_id = $1 AND kind = ANY($2::text[])`,
        [userId, on],
      );
    }
    return readLiveActivityPreferences(userId, client);
  });
}
