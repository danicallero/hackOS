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

/**
 * Role-assignment-as-trigger side of role_grant_rules (H8): a rule may fire
 * off ANOTHER role being assigned/removed instead of a domain trigger_event
 * — `source_role_id` is the admin-chosen "which role" parameter, so unlike
 * applyRoleGrantRule above (a fixed, developer-defined trigger_event string)
 * this reads `source_role_id = assignedRoleId` instead. Call this from the
 * SAME transaction as the role assignment it's reacting to
 * (identity/routes/roles.ts's POST .../users/:userId), immediately after the
 * INSERT into user_roles for `assignedRoleId` succeeds.
 *
 * Only `action = 'grant'` rows apply here — grant is unconditional (mirrors
 * applyRoleGrantRule: ON CONFLICT DO NOTHING, so re-assigning an already-held
 * source role is a no-op). The `source` column on the resulting user_roles
 * row is `role_assigned:<sourceRoleId>` so applyRoleAssignmentRevokeRules can
 * later tell an automatic grant apart from a manual one when deciding
 * whether it's still safe to revoke.
 */
export async function applyRoleAssignmentGrantRules(
  client: pg.PoolClient,
  userId: number,
  assignedRoleId: number,
  actorId: number | null = null,
): Promise<void> {
  const { rows } = await client.query(
    `SELECT id, role_id FROM role_grant_rules
      WHERE source_role_id = $1 AND action = 'grant' AND enabled = true`,
    [assignedRoleId],
  );
  for (const rule of rows as { id: number; role_id: number }[]) {
    const { rowCount } = await client.query(
      `INSERT INTO user_roles (user_id, role_id, assigned_by, source)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [userId, rule.role_id, actorId, `role_assigned:${assignedRoleId}`],
    );
    if (rowCount && rowCount > 0) {
      await audit(client, {
        actorId,
        entityType: "role",
        entityId: rule.role_id,
        action: "assign_user",
        source: "system",
        after: { userId, sourceRoleId: assignedRoleId },
      });
    }
  }
}

/**
 * The removal-side counterpart of applyRoleAssignmentGrantRules: when
 * `removedRoleId` is removed from a user, revoke every role an ENABLED
 * `action = 'revoke'` rule keyed on that source role names — but ONLY if no
 * OTHER currently-held role of the user still justifies it, i.e. either
 * another role the user still holds has its own enabled grant-type rule
 * targeting the same role, or the user's row for that role was assigned
 * `source = 'manual'` (an admin gave it to them directly, for an unrelated
 * reason) — either path means blindly revoking would strip access the user
 * still has a legitimate claim to (unlike applyRoleGrantRule's existing
 * revoke branch above, which is unconditional: today's two revoke triggers,
 * sponsor/judge unlink, only ever fire once the LAST such relationship is
 * gone, so there is no "other path" to check there).
 */
export async function applyRoleAssignmentRevokeRules(
  client: pg.PoolClient,
  userId: number,
  removedRoleId: number,
  actorId: number | null = null,
): Promise<void> {
  const { rows } = await client.query(
    `SELECT id, role_id FROM role_grant_rules
      WHERE source_role_id = $1 AND action = 'revoke' AND enabled = true`,
    [removedRoleId],
  );
  for (const rule of rows as { id: number; role_id: number }[]) {
    const targetRoleId = rule.role_id;
    const { rows: existing } = await client.query(
      `SELECT source FROM user_roles WHERE user_id = $1 AND role_id = $2`,
      [userId, targetRoleId],
    );
    if (existing.length === 0) continue; // Already doesn't hold it.
    if (existing[0].source === "manual") continue; // Held for an unrelated, admin-granted reason.
    const { rows: stillJustified } = await client.query(
      `SELECT 1
         FROM user_roles ur
         JOIN role_grant_rules rr ON rr.source_role_id = ur.role_id
        WHERE ur.user_id = $1
          AND ur.role_id <> $2
          AND rr.role_id = $3
          AND rr.action = 'grant'
          AND rr.enabled = true
        LIMIT 1`,
      [userId, removedRoleId, targetRoleId],
    );
    if (stillJustified.length > 0) continue; // Another held role still implies it.
    const { rowCount } = await client.query(
      `DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2`,
      [userId, targetRoleId],
    );
    if (rowCount && rowCount > 0) {
      await audit(client, {
        actorId,
        entityType: "role",
        entityId: targetRoleId,
        action: "remove_user",
        source: "system",
        before: { userId, sourceRoleId: removedRoleId },
      });
    }
  }
}
