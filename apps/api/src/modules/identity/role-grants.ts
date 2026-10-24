import type pg from "pg";
import { type AuditEntry, auditMany } from "../../lib/audit.js";

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
  const rules = rows as { id: number; role_id: number; action: "grant" | "revoke" }[];
  const grantRoleIds = rules.filter((rule) => rule.action === "grant").map((rule) => rule.role_id);
  const revokeRoleIds = rules
    .filter((rule) => rule.action === "revoke")
    .map((rule) => rule.role_id);
  const entries: AuditEntry[] = [];
  if (grantRoleIds.length > 0) {
    const { rows: granted } = await client.query(
      `INSERT INTO user_roles (user_id, role_id, assigned_by, source)
       SELECT $1::int, role_id, $3::int, $4::text FROM unnest($2::int[]) AS t(role_id)
       ON CONFLICT DO NOTHING
       RETURNING role_id`,
      [userId, grantRoleIds, actorId, triggerEvent],
    );
    for (const row of granted as { role_id: number }[]) {
      entries.push({
        actorId,
        entityType: "role",
        entityId: row.role_id,
        action: "assign_user",
        source: "system",
        after: { userId, triggerEvent },
      });
    }
  }
  if (revokeRoleIds.length > 0) {
    const { rows: revoked } = await client.query(
      `DELETE FROM user_roles WHERE user_id = $1 AND role_id = ANY($2::int[]) RETURNING role_id`,
      [userId, revokeRoleIds],
    );
    for (const row of revoked as { role_id: number }[]) {
      entries.push({
        actorId,
        entityType: "role",
        entityId: row.role_id,
        action: "remove_user",
        source: "system",
        before: { userId, triggerEvent },
      });
    }
  }
  await auditMany(client, entries);
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
  if (rows.length === 0) return;
  const { rows: granted } = await client.query(
    `INSERT INTO user_roles (user_id, role_id, assigned_by, source)
     SELECT $1::int, role_id, $3::int, $4::text FROM unnest($2::int[]) AS t(role_id)
     ON CONFLICT DO NOTHING
     RETURNING role_id`,
    [
      userId,
      (rows as { role_id: number }[]).map((rule) => rule.role_id),
      actorId,
      `role_assigned:${assignedRoleId}`,
    ],
  );
  await auditMany(
    client,
    (granted as { role_id: number }[]).map((row) => ({
      actorId,
      entityType: "role",
      entityId: row.role_id,
      action: "assign_user",
      source: "system",
      after: { userId, sourceRoleId: assignedRoleId },
    })),
  );
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
  if (rows.length === 0) return;
  // One DELETE applies the per-target guards: not held manually, and no other
  // held role still carries an enabled grant rule for the same target.
  const { rows: revoked } = await client.query(
    `DELETE FROM user_roles ur
      WHERE ur.user_id = $1
        AND ur.role_id = ANY($3::int[])
        AND ur.source IS DISTINCT FROM 'manual'
        AND NOT EXISTS (
          SELECT 1
            FROM user_roles held
            JOIN role_grant_rules rr ON rr.source_role_id = held.role_id
           WHERE held.user_id = $1
             AND held.role_id <> $2
             AND rr.role_id = ur.role_id
             AND rr.action = 'grant'
             AND rr.enabled = true
        )
      RETURNING ur.role_id`,
    [userId, removedRoleId, (rows as { role_id: number }[]).map((rule) => rule.role_id)],
  );
  await auditMany(
    client,
    (revoked as { role_id: number }[]).map((row) => ({
      actorId,
      entityType: "role",
      entityId: row.role_id,
      action: "remove_user",
      source: "system",
      before: { userId, sourceRoleId: removedRoleId },
    })),
  );
}
