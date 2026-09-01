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
 * Admin CRUD for `role_grant_rules` (H8, H43-H46): configurable automatic
 * role grant/revoke rules, decoupled from any one domain trigger. A rule
 * maps a fixed, developer-defined `trigger_event`
 * (packages/shared/src/role-grant-triggers.ts — the vocabulary of "what can
 * happen") to an admin-chosen role and action ("what results"), optionally
 * scoped to one enterprise. `identity/role-grants.ts`'s applyRoleGrantRule
 * is the runtime side that reads this table; this file is the only way to
 * write to it via HTTP.
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
  triggerEvent: z.string(),
  action: ruleAction,
  enabled: z.boolean(),
  enterpriseId: z.number().nullable(),
  enterpriseName: z.string().nullable(),
});

const ruleIdParams = z.object({ ruleId: z.coerce.number().int() });

const ROW_QUERY = `
  SELECT rr.id, rr.role_id, r.name AS role_name, rr.trigger_event, rr.action, rr.enabled,
         rr.enterprise_id, e.name AS enterprise_name
    FROM role_grant_rules rr
    JOIN roles r ON r.id = rr.role_id
    LEFT JOIN enterprises e ON e.id = rr.enterprise_id`;

function toResponse(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    roleId: Number(row.role_id),
    roleName: String(row.role_name),
    triggerEvent: String(row.trigger_event),
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
          "Lists every role_grant_rules row (H8): which trigger_event grants or revokes which role, optionally scoped to one enterprise (enterpriseId null = applies to every occurrence of that trigger). See packages/shared/src/role-grant-triggers.ts for the fixed vocabulary of trigger events a rule may react to.",
        response: { 200: z.array(ruleResponse) },
      },
    },
    async () => {
      const { rows } = await pool.query(`${ROW_QUERY} ORDER BY rr.trigger_event, rr.id`);
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
          "Creates a rule mapping a trigger_event (from the fixed registry, packages/shared/src/role-grant-triggers.ts — unknown strings are rejected) to a role and grant/revoke action, optionally scoped to one enterpriseId. Configuring a rule that grants/revokes role X is gated exactly like assigning X directly (H8): the actor's highest role must sit strictly above X's position, and (unless they hold the wildcard) they must already possess every capability X's own rows explicitly allow. A protected role can never be targeted.",
        body: z.object({
          roleId: z.number().int(),
          triggerEvent: z.string().min(1),
          action: ruleAction,
          enabled: z.boolean().default(true),
          enterpriseId: z.number().int().nullish(),
        }),
        response: { 201: ruleResponse },
      },
    },
    async (req, reply) => {
      const { roleId, triggerEvent, action, enabled, enterpriseId } = req.body;
      assertKnownTriggerEvent(triggerEvent);
      const actorId = req.userId as number;
      const rule = await withTransaction(async (client) => {
        await lockRoleGraph(client);
        await assertActorCanConfigureRule(client, actorId, roleId);
        await assertEnterpriseExists(client, enterpriseId ?? null);
        const { rows } = await client.query(
          `INSERT INTO role_grant_rules (role_id, trigger_event, action, enabled, enterprise_id)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [roleId, triggerEvent, action, enabled, enterpriseId ?? null],
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
          "Partial update of a rule's role, trigger_event, action, enabled flag, or enterprise scope (H8). Fields omitted are left unchanged. Changing roleId re-runs the same role-mutation authority + capability-possession guard as creation, evaluated against the NEW role.",
        params: ruleIdParams,
        body: z.object({
          roleId: z.number().int().optional(),
          triggerEvent: z.string().min(1).optional(),
          action: ruleAction.optional(),
          enabled: z.boolean().optional(),
          enterpriseId: z.number().int().nullish(),
        }),
        response: { 200: ruleResponse },
      },
    },
    async (req) => {
      const { ruleId } = req.params;
      if (req.body.triggerEvent !== undefined) assertKnownTriggerEvent(req.body.triggerEvent);
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
        const triggerEvent = req.body.triggerEvent ?? before.triggerEvent;
        const action = req.body.action ?? before.action;
        const enabled = req.body.enabled ?? before.enabled;
        await client.query(
          `UPDATE role_grant_rules
              SET role_id = $2, trigger_event = $3, action = $4, enabled = $5, enterprise_id = $6
            WHERE id = $1`,
          [ruleId, roleId, triggerEvent, action, enabled, enterpriseId],
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
