import { CAPABILITIES } from "@hackos/shared/capabilities";
import {
  LIVE_ACTIVITY_CONFIG_KINDS,
  type LiveActivityConfigKind,
  type LiveActivityKindSetting,
  type LiveActivitySettings,
} from "@hackos/shared/live-activities";
import { config } from "../../config.js";
import { pool, type Queryable, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError } from "../../lib/errors.js";

/**
 * Organizer configuration of Live Activity kinds (#966; H8, H53): which kinds
 * are on, their priority on a device that has more candidates than
 * `maxConcurrent`, and which roles may receive each. The role list narrows
 * the audience; it never replaces a kind's intrinsic gate below.
 */

/** The capability a kind still requires on top of its role list (null = data-gated only). */
export const LIVE_ACTIVITY_REQUIRED_CAPABILITY: Record<LiveActivityConfigKind, string | null> = {
  activity: CAPABILITIES.ACTIVITY_SCAN,
  attendee_activity: null,
  queue: null,
  deadline: CAPABILITIES.QUEUE_STATUS,
  accreditation: CAPABILITIES.ACCREDIT_SCAN,
};

const DEFAULT_MAX_CONCURRENT = 2;

/**
 * Minutes before a schedule item starts that its staff or attendee Live
 * Activity appears (H25, H26, H59). An organizer override wins; without one
 * the deployment's `LIVE_ACTIVITY_LEAD_MINUTES` applies (R018: only intentional
 * overrides are stored). The deadline and accreditation leads stay
 * deployment-only: they anchor to the hacking window, not to schedule items.
 */
export async function readLeadMinutes(db: Queryable = pool): Promise<number> {
  const { rows } = await db.query<{ lead_minutes: number | null }>(
    `SELECT lead_minutes FROM live_activity_settings WHERE id = 1`,
  );
  return rows[0]?.lead_minutes ?? config.LIVE_ACTIVITY_LEAD_MINUTES;
}

/**
 * The stored configuration, sorted by priority. Missing rows (never in a
 * migrated database, but possible after a manual cleanup) read as a disabled
 * kind with no roles, ranked after the configured ones in the default order,
 * so a gap fails closed rather than showing a surface to everyone.
 */
export async function readLiveActivitySettings(
  db: Queryable = pool,
): Promise<LiveActivitySettings> {
  // Sequential: `db` may be one transaction client.
  const { rows: settingsRows } = await db.query<{
    max_concurrent: number;
    lead_minutes: number | null;
  }>(`SELECT max_concurrent, lead_minutes FROM live_activity_settings WHERE id = 1`);
  const { rows: kindRows } = await db.query<{
    kind: LiveActivityConfigKind;
    enabled: boolean;
    priority: number;
  }>(`SELECT kind, enabled, priority FROM live_activity_kind_settings`);
  const { rows: roleRows } = await db.query<{ kind: LiveActivityConfigKind; role_ids: number[] }>(
    `SELECT kr.kind, array_agg(kr.role_id ORDER BY kr.role_id) AS role_ids
       FROM live_activity_kind_roles kr
       JOIN roles r ON r.id = kr.role_id AND r.deleted_at IS NULL
      GROUP BY kr.kind`,
  );
  const { rows: allRoles } = await db.query<{ id: number; name: string }>(
    `SELECT id, name FROM roles WHERE deleted_at IS NULL ORDER BY position DESC`,
  );
  const stored = new Map(kindRows.map((row) => [row.kind, row]));
  const roles = new Map(roleRows.map((row) => [row.kind, row.role_ids]));
  const kinds: (LiveActivityKindSetting & { order: number })[] = LIVE_ACTIVITY_CONFIG_KINDS.map(
    (kind, index) => {
      const row = stored.get(kind);
      return {
        kind,
        enabled: row?.enabled ?? false,
        priority: row?.priority ?? 0,
        roleIds: roles.get(kind) ?? [],
        requiredCapability: LIVE_ACTIVITY_REQUIRED_CAPABILITY[kind],
        order: row ? row.priority : 1_000 + index,
      };
    },
  );
  kinds.sort((a, b) => a.order - b.order);
  return {
    maxConcurrent: settingsRows[0]?.max_concurrent ?? DEFAULT_MAX_CONCURRENT,
    leadMinutes: settingsRows[0]?.lead_minutes ?? config.LIVE_ACTIVITY_LEAD_MINUTES,
    defaultLeadMinutes: config.LIVE_ACTIVITY_LEAD_MINUTES,
    leadMinutesCustom: settingsRows[0]?.lead_minutes != null,
    // Priorities are reported as consecutive ranks, so the UI and the
    // ranking never see gaps.
    kinds: kinds.map(({ order: _order, ...kind }, index) => ({ ...kind, priority: index })),
    roles: allRoles,
  };
}

export interface LiveActivitySettingsInput {
  maxConcurrent: number;
  /** Lead time in minutes; `undefined` keeps the stored value, `null` returns to the deployment default. */
  leadMinutes?: number | null;
  /** Every configurable kind exactly once; array order is the priority (index 0 = highest). */
  kinds: { kind: LiveActivityConfigKind; enabled: boolean; roleIds: number[] }[];
}

/** Replaces the whole configuration in one transaction, audited (H53). */
export async function saveLiveActivitySettings(
  actorId: number,
  input: LiveActivitySettingsInput,
): Promise<LiveActivitySettings> {
  return withTransaction(async (client) => {
    // Serialize concurrent saves on the singleton row.
    await client.query(
      `INSERT INTO live_activity_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`,
    );
    await client.query(`SELECT id FROM live_activity_settings WHERE id = 1 FOR UPDATE`);
    const before = await readLiveActivitySettings(client);

    const roleIds = [...new Set(input.kinds.flatMap((k) => k.roleIds))];
    if (roleIds.length > 0) {
      const { rows } = await client.query<{ id: number }>(
        `SELECT id FROM roles WHERE id = ANY($1::int[]) AND deleted_at IS NULL`,
        [roleIds],
      );
      const known = new Set(rows.map((r) => r.id));
      const unknown = roleIds.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        throw new BadRequestError(`Unknown role ids: ${unknown.join(", ")}`, { roleIds: unknown });
      }
    }

    await client.query(`UPDATE live_activity_settings SET max_concurrent = $1 WHERE id = 1`, [
      input.maxConcurrent,
    ]);
    if (input.leadMinutes !== undefined) {
      // R018: a value equal to the deployment default is stored as "no override".
      const override =
        input.leadMinutes === null || input.leadMinutes === config.LIVE_ACTIVITY_LEAD_MINUTES
          ? null
          : input.leadMinutes;
      await client.query(`UPDATE live_activity_settings SET lead_minutes = $1 WHERE id = 1`, [
        override,
      ]);
    }
    for (const [priority, kind] of input.kinds.entries()) {
      await client.query(
        `INSERT INTO live_activity_kind_settings (kind, enabled, priority)
         VALUES ($1, $2, $3)
         ON CONFLICT (kind) DO UPDATE SET enabled = EXCLUDED.enabled, priority = EXCLUDED.priority`,
        [kind.kind, kind.enabled, priority],
      );
      await client.query(`DELETE FROM live_activity_kind_roles WHERE kind = $1`, [kind.kind]);
      if (kind.roleIds.length > 0) {
        await client.query(
          `INSERT INTO live_activity_kind_roles (kind, role_id)
           SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`,
          [kind.kind, kind.roleIds],
        );
      }
    }

    const after = await readLiveActivitySettings(client);
    await audit(client, {
      actorId,
      entityType: "live_activity_settings",
      entityId: 1,
      action: "update",
      before,
      after,
    });
    return after;
  });
}
