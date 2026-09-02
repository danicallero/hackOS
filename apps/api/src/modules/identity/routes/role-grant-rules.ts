import { CAPABILITIES } from "@hackos/shared/capabilities";
import { ALL_TRIGGER_EVENTS, isKnownTriggerEvent } from "@hackos/shared/role-grant-triggers";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool, withTransaction } from "../../../db/pool.js";
import { audit } from "../../../lib/audit.js";
import { requireCapability } from "../../../lib/capabilities.js";
import { BadRequestError, NotFoundError } from "../../../lib/errors.js";
import { routeAccessConfig as routeAccess } from "../../../lib/route-policy.js";
import {
  assertNotProtectedRole,
  lockRoleGraph,
  type RoleGraphClient,
  requireCapabilityPossessionForAssignment,
  requireRoleMutationAuthority,
} from "../role-authority.js";

/**
 * A rule keyed off `source_role_id` fires when THAT role is assigned/removed
 * (H8, role-assignment-as-trigger) — a parallel matching key to
 * `trigger_event`, mutually exclusive with it (0812's CHECK constraint).
 * Detects a longer cycle (A implies B implies ... implies A) that the CHECK
 * constraint can't express on its own: walks OUTWARD from `targetRoleId`
 * (the role the candidate rule would grant) along existing ENABLED
 * `action = 'grant'` edges — if that walk ever reaches `sourceRoleId` (the
 * role the candidate rule would fire on), granting `sourceRoleId` would
 * eventually re-imply itself. Disabled rows still count: a disabled rule can
 * be re-enabled later, so a structurally-cyclic graph is rejected even while
 * dormant. `excludeRuleId` skips a rule's own row so PATCHing a rule against
 * itself doesn't trivially "detect" its own existing edge.
 */
async function wouldCreateRoleImplicationCycle(
  client: RoleGraphClient,
  sourceRoleId: number,
  targetRoleId: number,
  excludeRuleId: number | null = null,
): Promise<boolean> {
  if (sourceRoleId === targetRoleId) return true;
  const visited = new Set<number>([targetRoleId]);
  let frontier = [targetRoleId];
  while (frontier.length > 0) {
    const { rows } = await client.query(
      `SELECT role_id FROM role_grant_rules
        WHERE source_role_id = ANY($1::int[]) AND action = 'grant'
          AND ($2::int IS NULL OR id <> $2)`,
      [frontier, excludeRuleId],
    );
    const next: number[] = [];
    for (const row of rows as { role_id: number }[]) {
      const roleId = Number(row.role_id);
      if (roleId === sourceRoleId) return true;
      if (!visited.has(roleId)) {
        visited.add(roleId);
        next.push(roleId);
      }
    }
    frontier = next;
  }
  return false;
}

/**
 * Admin CRUD for `role_grant_rules` (H8, H43-H46): configurable automatic
 * role grant/revoke rules, decoupled from any one domain trigger. A rule
 * fires off either of two mutually-exclusive keys: a fixed, developer-
 * defined `trigger_event` (packages/shared/src/role-grant-triggers.ts — the
 * vocabulary of "what can happen") OR `source_role_id`, an admin-chosen role
 * whose own assignment/removal fires the rule (role-assignment-as-trigger,
 * 0812 — "assigning role X also grants role Y"). Either way the rule maps
 * onto an admin-chosen role and action ("what results"), optionally scoped
 * to one enterprise (trigger_event rules only). `identity/role-grants.ts`'s
 * applyRoleGrantRule/applyRoleAssignmentGrantRules/
 * applyRoleAssignmentRevokeRules are the runtime side that reads this table;
 * this file is the only way to write to it via HTTP.
 *
 * This is the SAME privilege-escalation surface as directly assigning a
 * role, or configuring `applications.grants_role_ids` (applications/
 * admin.routes.ts): an admin-configured "grant role X automatically" rule
 * hands X to anyone who trips the trigger, so creating/editing a rule that
 * grants (or revokes — revoking is also an authority-bearing act, see
 * below) a role goes through the exact same guards as role assignment:
 * `requireRoleMutationAuthority` (position hierarchy — the target role must
 * sit strictly below the actor's own highest role) and
 * `requireCapabilityPossessionForAssignment` (the actor must already
 * possess every capability the role's own rows explicitly ALLOW, unless
 * they hold the wildcard). A protected role (`is_protected`) can never be
 * targeted by a rule, mirroring every other role-mutation route.
 */

const manage = requireCapability(CAPABILITIES.PERMISSIONS_MANAGE);

const ruleAction = z.enum(["grant", "revoke"]);

const ruleResponse = z.object({
  id: z.number(),
  roleId: z.number(),
  roleName: z.string(),
  /** Null when this rule's trigger is `sourceRoleId` instead (mutually exclusive, H8). */
  triggerEvent: z.string().nullable(),
  /** Null when this rule's trigger is `triggerEvent` instead. Set = "fires on this role's assign/removal" (H8). */
  sourceRoleId: z.number().nullable(),
  sourceRoleName: z.string().nullable(),
  action: ruleAction,
  enabled: z.boolean(),
  enterpriseId: z.number().nullable(),
  enterpriseName: z.string().nullable(),
});

const ruleIdParams = z.object({ ruleId: z.coerce.number().int() });

const ROW_QUERY = `
  SELECT rr.id, rr.role_id, r.name AS role_name, rr.trigger_event, rr.action, rr.enabled,
         rr.enterprise_id, e.name AS enterprise_name,
         rr.source_role_id, sr.name AS source_role_name
    FROM role_grant_rules rr
    JOIN roles r ON r.id = rr.role_id
    LEFT JOIN enterprises e ON e.id = rr.enterprise_id
    LEFT JOIN roles sr ON sr.id = rr.source_role_id`;

function toResponse(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    roleId: Number(row.role_id),
    roleName: String(row.role_name),
    triggerEvent: row.trigger_event === null ? null : String(row.trigger_event),
    sourceRoleId: row.source_role_id === null ? null : Number(row.source_role_id),
    sourceRoleName: row.source_role_name === null ? null : String(row.source_role_name),
    action: row.action as "grant" | "revoke",
    enabled: Boolean(row.enabled),
    enterpriseId: row.enterprise_id === null ? null : Number(row.enterprise_id),
    enterpriseName: row.enterprise_name === null ? null : String(row.enterprise_name),
  };
}

async function loadRule(client: RoleGraphClient, ruleId: number) {
  const { rows } = await client.query(`${ROW_QUERY} WHERE rr.id = $1`, [ruleId]);
  if (!rows[0]) throw new NotFoundError("Role grant rule not found", { ruleId });
  return toResponse(rows[0]);
}

function assertKnownTriggerEvent(triggerEvent: string): void {
  if (!isKnownTriggerEvent(triggerEvent)) {
    throw new BadRequestError("Unknown trigger event", {
      triggerEvent,
      known: ALL_TRIGGER_EVENTS,
    });
  }
}

async function assertEnterpriseExists(
  client: RoleGraphClient,
  enterpriseId: number | null | undefined,
): Promise<void> {
  if (enterpriseId == null) return;
  const { rows } = await client.query(`SELECT 1 FROM enterprises WHERE id = $1`, [enterpriseId]);
  if (!rows[0]) throw new NotFoundError("Enterprise not found", { enterpriseId });
}

/**
 * Validates a candidate (sourceRoleId, roleId) pair for a role-assignment-
 * triggered rule (H8): the source role must exist, can't equal the target
 * role (also a DB CHECK, but this gives a clean 400 instead of a constraint
 * violation), and can't create a longer implication cycle through existing
 * rules. `excludeRuleId` is the rule being edited, so it doesn't collide
 * with its own current edge.
 */
async function assertValidSourceRole(
  client: RoleGraphClient,
  sourceRoleId: number,
  roleId: number,
  excludeRuleId: number | null = null,
): Promise<void> {
  const { rows } = await client.query(`SELECT is_protected, name FROM roles WHERE id = $1`, [
    sourceRoleId,
  ]);
  if (!rows[0]) throw new NotFoundError("Source role not found", { sourceRoleId });
  assertNotProtectedRole({ isProtected: rows[0].is_protected as boolean, name: rows[0].name });
  if (sourceRoleId === roleId) {
    throw new BadRequestError("A role cannot imply itself", { sourceRoleId, roleId });
  }
  if (await wouldCreateRoleImplicationCycle(client, sourceRoleId, roleId, excludeRuleId)) {
    throw new BadRequestError(
      "This rule would create a cycle of role implications (A implies B implies ... implies A)",
      { sourceRoleId, roleId },
    );
  }
}

/**
 * Validates a create/update request body's trigger fields (H8): exactly one
 * of triggerEvent/sourceRoleId must resolve to non-null. Returns the
 * resolved pair so callers write a single source of truth to the DB.
 */
function resolveTrigger(
  triggerEvent: string | null,
  sourceRoleId: number | null,
): { triggerEvent: string | null; sourceRoleId: number | null } {
  if ((triggerEvent === null) === (sourceRoleId === null)) {
    throw new BadRequestError("Exactly one of triggerEvent or sourceRoleId must be set", {
      triggerEvent,
      sourceRoleId,
    });
  }
  if (triggerEvent !== null) assertKnownTriggerEvent(triggerEvent);
  return { triggerEvent, sourceRoleId };
}

/**
 * The same authority pair role assignment and `applications.grants_role_ids`
 * use, applied to the role a rule would grant/revoke — independent of and in
 * addition to `manage`'s capability gate on the route itself.
 */
async function assertActorCanConfigureRule(
  client: RoleGraphClient,
  actorId: number,
  roleId: number,
): Promise<void> {
  const { rows } = await client.query(
    `SELECT id, name, position, is_protected FROM roles WHERE id = $1`,
    [roleId],
  );
  if (!rows[0]) throw new NotFoundError("Role not found", { roleId });
  const role = {
    isProtected: rows[0].is_protected as boolean,
    name: rows[0].name as string,
  };
  assertNotProtectedRole(role);
  await requireRoleMutationAuthority(client, actorId, Number(rows[0].position));
  await requireCapabilityPossessionForAssignment(client, actorId, roleId);
}

export function registerRoleGrantRuleRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get(
    "/api/role-grant-rules",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: {
        summary: "List automatic role grant/revoke rules",
        description:
          "Lists role_grant_rules rows (H8): which trigger_event grants or revokes which role, optionally scoped to one enterprise (enterpriseId null = applies to every occurrence of that trigger). Pass roleId to list only the rules that grant/revoke that one role — the per-role Grant Rules tab on the role editor uses this; omitted, every rule in the system is returned (the read-only cross-role audit view). See packages/shared/src/role-grant-triggers.ts for the fixed vocabulary of trigger events a rule may react to.",
        querystring: z.object({ roleId: z.coerce.number().int().optional() }),
        response: { 200: z.array(ruleResponse) },
      },
    },
    async (req) => {
      const { roleId } = req.query;
      const { rows } = roleId
        ? await pool.query(`${ROW_QUERY} WHERE rr.role_id = $1 ORDER BY rr.trigger_event, rr.id`, [
            roleId,
          ])
        : await pool.query(`${ROW_QUERY} ORDER BY rr.trigger_event, rr.id`);
      return rows.map(toResponse);
    },
  );

  api.post(
    "/api/role-grant-rules",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: {
        summary: "Create an automatic role grant/revoke rule",
        description:
          "Creates a rule that fires either off a trigger_event (from the fixed registry, packages/shared/src/role-grant-triggers.ts — unknown strings are rejected) or off sourceRoleId — a role whose own assignment (action=grant) or removal (action=revoke) fires the rule instead (H8 role-assignment-as-trigger). Exactly one of triggerEvent/sourceRoleId must be set. A sourceRoleId rule is rejected if it would create a cycle of role implications (A implies B implies ... implies A). Either way the rule grants/revokes `roleId`, optionally scoped to one enterpriseId. Configuring a rule that grants/revokes role X is gated exactly like assigning X directly (H8): the actor's highest role must sit strictly above X's position, and (unless they hold the wildcard) they must already possess every capability X's own rows explicitly allow. A protected role can never be targeted (as roleId or sourceRoleId).",
        body: z.object({
          roleId: z.number().int(),
          triggerEvent: z.string().min(1).nullish(),
          sourceRoleId: z.number().int().nullish(),
          action: ruleAction,
          enabled: z.boolean().default(true),
          enterpriseId: z.number().int().nullish(),
        }),
        response: { 201: ruleResponse },
      },
    },
    async (req, reply) => {
      const { roleId, action, enabled, enterpriseId } = req.body;
      const { triggerEvent, sourceRoleId } = resolveTrigger(
        req.body.triggerEvent ?? null,
        req.body.sourceRoleId ?? null,
      );
      const actorId = req.userId as number;
      const rule = await withTransaction(async (client) => {
        await lockRoleGraph(client);
        await assertActorCanConfigureRule(client, actorId, roleId);
        await assertEnterpriseExists(client, enterpriseId ?? null);
        if (sourceRoleId !== null) await assertValidSourceRole(client, sourceRoleId, roleId);
        const { rows } = await client.query(
          `INSERT INTO role_grant_rules (role_id, trigger_event, source_role_id, action, enabled, enterprise_id)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [roleId, triggerEvent, sourceRoleId, action, enabled, enterpriseId ?? null],
        );
        const ruleId = rows[0].id as number;
        const created = await loadRule(client, ruleId);
        await audit(client, {
          actorId,
          entityType: "role_grant_rule",
          entityId: ruleId,
          action: "create",
          source: "admin",
          after: created,
        });
        return created;
      });
      return reply.code(201).send(rule);
    },
  );

  api.patch(
    "/api/role-grant-rules/:ruleId",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: {
        summary: "Update an automatic role grant/revoke rule",
        description:
          "Partial update of a rule's role, trigger (triggerEvent XOR sourceRoleId), action, enabled flag, or enterprise scope (H8). Fields omitted are left unchanged; setting one trigger field to a non-null value clears the other. Changing roleId re-runs the same role-mutation authority + capability-possession guard as creation, evaluated against the NEW role. Changing roleId or sourceRoleId on a sourceRoleId-triggered rule re-runs the cycle check.",
        params: ruleIdParams,
        body: z.object({
          roleId: z.number().int().optional(),
          triggerEvent: z.string().min(1).nullish(),
          sourceRoleId: z.number().int().nullish(),
          action: ruleAction.optional(),
          enabled: z.boolean().optional(),
          enterpriseId: z.number().int().nullish(),
        }),
        response: { 200: ruleResponse },
      },
    },
    async (req) => {
      const { ruleId } = req.params;
      const actorId = req.userId as number;
      return withTransaction(async (client) => {
        await lockRoleGraph(client);
        const before = await loadRule(client, ruleId);
        // Re-check authority against BOTH the current role (before any
        // change is applied) and the new role if roleId is being changed —
        // an actor must be allowed to touch what the rule already does as
        // well as what it would newly do.
        await assertActorCanConfigureRule(client, actorId, before.roleId);
        const roleId = req.body.roleId ?? before.roleId;
        if (roleId !== before.roleId) await assertActorCanConfigureRule(client, actorId, roleId);
        const enterpriseIdProvided = "enterpriseId" in req.body;
        const enterpriseId = enterpriseIdProvided
          ? (req.body.enterpriseId ?? null)
          : before.enterpriseId;
        await assertEnterpriseExists(client, enterpriseId);

        // Setting either trigger field to a non-null value clears the other
        // — see resolveTrigger's doc comment for the mutual-exclusivity rule.
        let triggerEvent =
          "triggerEvent" in req.body ? (req.body.triggerEvent ?? null) : before.triggerEvent;
        let sourceRoleId =
          "sourceRoleId" in req.body ? (req.body.sourceRoleId ?? null) : before.sourceRoleId;
        if ("triggerEvent" in req.body && req.body.triggerEvent != null) sourceRoleId = null;
        if ("sourceRoleId" in req.body && req.body.sourceRoleId != null) triggerEvent = null;
        ({ triggerEvent, sourceRoleId } = resolveTrigger(triggerEvent, sourceRoleId));
        if (sourceRoleId !== null) {
          await assertValidSourceRole(client, sourceRoleId, roleId, ruleId);
        }

        const action = req.body.action ?? before.action;
        const enabled = req.body.enabled ?? before.enabled;
        await client.query(
          `UPDATE role_grant_rules
              SET role_id = $2, trigger_event = $3, source_role_id = $4, action = $5, enabled = $6, enterprise_id = $7
            WHERE id = $1`,
          [ruleId, roleId, triggerEvent, sourceRoleId, action, enabled, enterpriseId],
        );
        const updated = await loadRule(client, ruleId);
        await audit(client, {
          actorId,
          entityType: "role_grant_rule",
          entityId: ruleId,
          action: "update",
          source: "admin",
          before,
          after: updated,
        });
        return updated;
      });
    },
  );

  api.delete(
    "/api/role-grant-rules/:ruleId",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: {
        summary: "Delete an automatic role grant/revoke rule",
        description:
          "Deletes a role_grant_rules row (H8). Gated by the same role-mutation authority + capability-possession guard as creation, evaluated against the rule's current role.",
        params: ruleIdParams,
        response: { 200: z.object({ deleted: z.literal(true) }) },
      },
    },
    async (req) => {
      const { ruleId } = req.params;
      const actorId = req.userId as number;
      await withTransaction(async (client) => {
        await lockRoleGraph(client);
        const before = await loadRule(client, ruleId);
        await assertActorCanConfigureRule(client, actorId, before.roleId);
        await client.query(`DELETE FROM role_grant_rules WHERE id = $1`, [ruleId]);
        await audit(client, {
          actorId,
          entityType: "role_grant_rule",
          entityId: ruleId,
          action: "delete",
          source: "admin",
          before,
        });
      });
      return { deleted: true as const };
    },
  );
}
