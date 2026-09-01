import type pg from "pg";
import { audit } from "../../lib/audit.js";

/**
 * Optional context a trigger event fired FOR — today, just the enterprise a
 * sponsor/judge event concerns. Passed through to the rule lookup so an
 * admin-configured rule can be scoped to that one enterprise instead of (or
 * in addition to) applying globally (H8).
 */
export interface RoleGrantContext {
  enterpriseId?: number;
}

/**
 * Generic automatic role grant/revoke rules (H8), decoupled from any
 * specific domain: `role_grant_rules` maps a `trigger_event` string to one
 * or more (role, action) pairs, each optionally scoped to a single
 * `enterprise_id` (NULL = applies to every occurrence of that trigger). Call
 * this from the SAME transaction as the domain event it's reacting to (e.g.
 * sponsors/service.ts's addEnterpriseMember/addEnterpriseJudge,
 * identity/routes/invites.ts's sponsor-invite acceptance branch) instead of
 * writing to user_roles ad hoc at each call site — every automatic grant
 * routes through here so the rule table stays the single source of "what
 * triggers what". Pass `context.enterpriseId` whenever the event concerns a
 * specific enterprise so both a global AND an enterprise-scoped rule for the
 * same trigger_event can match and both apply.
 *
 * `triggerEvent` should always be one of TRIGGER_EVENTS
 * (packages/shared/src/role-grant-triggers.ts) — the admin-facing CRUD
 * routes validate against that registry, but this function itself trusts
 * its caller since every call site here is developer-authored, not
 * user-supplied.
 */
export async function applyRoleGrantRule(
  client: pg.PoolClient,
  userId: number,
  triggerEvent: string,
  actorId: number | null = null,
  context: RoleGrantContext = {},
): Promise<void> {
  const { rows } = await client.query(
    `SELECT id, role_id, action FROM role_grant_rules
      WHERE trigger_event = $1 AND enabled = true
        AND (enterprise_id IS NULL OR enterprise_id = $2)`,
    [triggerEvent, context.enterpriseId ?? null],
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
