import type pg from "pg";
import { audit } from "../../lib/audit.js";

/**
 * Generic automatic role grant/revoke rules (H8), decoupled from any
 * specific domain: `role_grant_rules` maps a `trigger_event` string to one
 * or more (role, action) pairs. Call this from the SAME transaction as the
 * domain event it's reacting to (e.g. sponsors/service.ts's
 * addEnterpriseMember, identity/routes/invites.ts's sponsor-invite
 * acceptance branch) instead of writing to user_roles ad hoc at each call
 * site — every automatic grant routes through here so the rule table stays
 * the single source of "what triggers what".
 */
export async function applyRoleGrantRule(
  client: pg.PoolClient,
  userId: number,
  triggerEvent: string,
  actorId: number | null = null,
): Promise<void> {
  const { rows } = await client.query(
    `SELECT id, role_id, action FROM role_grant_rules WHERE trigger_event = $1 AND enabled = true`,
    [triggerEvent],
  );
  for (const rule of rows as { id: number; role_id: number; action: "grant" | "revoke" }[]) {
    if (rule.action === "grant") {
      const { rowCount } = await client.query(
        `INSERT INTO user_roles (user_id, role_id, assigned_by, source)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [userId, rule.role_id, actorId, triggerEvent],
      );
      if (rowCount && rowCount > 0) {
        await audit(client, {
          actorId,
          entityType: "role",
          entityId: rule.role_id,
          action: "assign_user",
          source: "system",
          after: { userId, triggerEvent },
        });
      }
    } else {
      const { rowCount } = await client.query(
        `DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2`,
        [userId, rule.role_id],
      );
      if (rowCount && rowCount > 0) {
        await audit(client, {
          actorId,
          entityType: "role",
          entityId: rule.role_id,
          action: "remove_user",
          source: "system",
          before: { userId, triggerEvent },
        });
      }
    }
  }
}
