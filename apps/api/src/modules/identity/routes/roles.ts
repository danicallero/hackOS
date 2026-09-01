import { ALL_CAPABILITIES, CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type pg from "pg";
import { z } from "zod";
import { pool, withTransaction } from "../../../db/pool.js";
import { audit } from "../../../lib/audit.js";
import {
  assertKnownCapabilities,
  requireAnyCapability,
  requireCapability,
  userHasCapability,
} from "../../../lib/capabilities.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../../lib/errors.js";
import { routeAccessConfig as routeAccess } from "../../../lib/route-policy.js";
import { broadcast } from "../../../lib/sse.js";
import { issueTicket } from "../../logistics/tickets.js";
import {
  assertActiveWildcardHolder,
  assertNotSuperadminRole,
  lockRoleGraph,
  requireCapabilityPossessionForAssignment,
  requireCapabilityPossessionForStateChange,
  requireRoleMutationAuthority,
  requireWildcardRoleAuthority,
  roleGrantsWildcard,
  userHasAnyCapability,
} from "../role-authority.js";
import { getPermissionGroupTemplate, PERMISSION_GROUP_TEMPLATES } from "../templates.js";

/**
 * Role management (H8): a hierarchical, position-ordered multi-role model replaces
 * capability groups as the authorization source. A user may hold several
 * roles; roles sit on one global reorderable hierarchy (`position`, higher =
 * more priority); each role holds an ALLOW/DENY/INHERIT tri-state per
 * capability, resolved over the user's OWN assigned roles ordered by
 * position descending (lib/capabilities.ts). To assign/remove/edit/reorder a
 * role, the actor needs PERMISSIONS_MANAGE AND the role's position (its NEW
 * position, for a reorder) must sit strictly below the actor's own highest
 * assigned role — enforced here, not just in the UI. Every mutation is
 * audited (H53) and broadcast on the identity topic (H7-H10) in the same
 * transaction as the write.
 *
 * `system:superadmin` is the one exception: every mutation route refuses it
 * outright via `assertNotSuperadminRole` (role-authority.ts), unconditional
 * on the actor's own capabilities — it can only be granted/revoked/created
 * via server-shell CLI scripts (scripts/grant-superadmin.mjs,
 * scripts/create-superadmin.ts, scripts/revoke-superadmin.mjs). DELETE
 * soft-deletes (`roles.deleted_at`, 0804) instead of removing the row;
 * POST .../restore reverses it, 409ing only if another role has since taken
 * its exact position (see that route's own schema description).
 */

const manage = requireCapability(CAPABILITIES.PERMISSIONS_MANAGE);
const readRoles = requireAnyCapability(
  CAPABILITIES.PERMISSIONS_MANAGE,
  CAPABILITIES.INVITES_MANAGE,
);

const permissionState = z.enum(["allow", "deny", "inherit"]);
const roleIdParams = z.object({ roleId: z.coerce.number().int() });

// H8 full-replacement: the fixed bucket badge printing/wallet passes/scanner
// UI/stats classify this role's holders into, decoupled from the role's own
// (admin-chosen) name. See roles.badge_category (0800) and identity/role.ts's
// getBadgeCategory/getEffectiveRole.
const badgeCategory = z.enum(["admin", "judge", "sponsor", "staff", "mentor", "participant"]);

const roleResponse = z.object({
  id: z.number(),
  name: z.string(),
  position: z.number(),
  isVisible: z.boolean(),
  isProtected: z.boolean(),
  // H8/0800/0807: true for a role inserted by a seed migration (0801's
  // Sponsor, every 0805 default) rather than created via POST /api/roles.
  // Scopes the trash/restore panel and gates the reset-to-default action.
  isSeeded: z.boolean(),
  badgeCategory,
  // Sparse: capabilities with no explicit row are implicitly 'inherit' and
  // omitted (mirrors the role_capabilities table — a missing row IS inherit).
  capabilities: z.array(z.object({ capability: z.string(), state: permissionState })),
  memberIds: z.array(z.number()),
  // H8: soft-delete marker (0804). Non-null means this role no longer grants
  // anything and is hidden from the default GET /api/roles listing.
  deletedAt: z.string().nullable(),
});

const seedDiffEntry = z.object({
  capability: z.string(),
  current: permissionState,
  default: permissionState,
});

const seedDiffResponse = z.object({
  isSeeded: z.boolean(),
  hasDrifted: z.boolean(),
  diff: z.array(seedDiffEntry),
});

async function loadRole(db: pg.Pool | pg.PoolClient, roleId: number) {
  const { rows } = await db.query(`SELECT * FROM roles WHERE id = $1`, [roleId]);
  if (!rows[0]) throw new NotFoundError("Role not found", { roleId });
  // Sequential on purpose: `db` may be a single PoolClient inside a
  // transaction, which cannot run queries concurrently.
  const caps = await db.query(
    `SELECT capability, state FROM role_capabilities WHERE role_id = $1 ORDER BY capability`,
    [roleId],
  );
  const members = await db.query(
    `SELECT user_id FROM user_roles WHERE role_id = $1 ORDER BY user_id`,
    [roleId],
  );
  return {
    id: rows[0].id as number,
    name: rows[0].name as string,
    position: rows[0].position as number,
    isVisible: rows[0].is_visible as boolean,
    isProtected: rows[0].is_protected as boolean,
    isSeeded: rows[0].is_seeded as boolean,
    badgeCategory: rows[0].badge_category as z.infer<typeof badgeCategory>,
    capabilities: caps.rows as { capability: string; state: "allow" | "deny" | "inherit" }[],
    memberIds: members.rows.map((r: { user_id: number }) => r.user_id),
    deletedAt: rows[0].deleted_at ? new Date(rows[0].deleted_at).toISOString() : null,
  };
}

function announceRoleChange(): void {
  broadcast(SSE_TOPICS.IDENTITY, EVENTS.DOMAIN_CHANGED, {});
}

export function registerRoleRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get(
    "/api/role-templates",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: {
        summary: "List role-creation templates",
        description:
          "Returns the stable H8 template catalogue used to prefill a new role's capabilities. Labels/descriptions are message keys for the client i18n catalogue; `sponsor:portal` is deliberately absent.",
        response: {
          200: z.array(
            z.object({
              key: z.string(),
              labelKey: z.string(),
              descriptionKey: z.string(),
              capabilities: z.array(z.string()),
            }),
          ),
        },
      },
    },
    async () =>
      PERMISSION_GROUP_TEMPLATES.map((template) => ({
        ...template,
        capabilities: [...template.capabilities],
      })),
  );

  api.get(
    "/api/roles",
    {
      preHandler: readRoles,
      config: routeAccess({
        kind: "capability",
        anyOf: [CAPABILITIES.PERMISSIONS_MANAGE, CAPABILITIES.INVITES_MANAGE],
      }),
      schema: {
        summary: "List roles by position",
        description:
          "Lists every non-deleted role highest-position first (H8). Invitation managers get this same read access to choose deferred role pre-assignments; only PERMISSIONS_MANAGE can mutate. Pass includeDeleted=true (PERMISSIONS_MANAGE only) to ALSO list soft-deleted roles, scoped to is_seeded=true ones only — the trash/restore panel only ever offers back roles from the seeded default catalogue (0801/0805), never a custom role an admin created and later deleted. Non-deleted roles in the response are unaffected by this scoping.",
        querystring: z.object({ includeDeleted: z.coerce.boolean().default(false) }),
        response: { 200: z.array(roleResponse) },
      },
    },
    async (req) => {
      const includeDeleted =
        req.query.includeDeleted &&
        (await userHasCapability(req.userId as number, CAPABILITIES.PERMISSIONS_MANAGE, req));
      const { rows } = await pool.query(
        `SELECT id FROM roles
          WHERE deleted_at IS NULL OR ($1 AND is_seeded)
          ORDER BY position DESC`,
        [includeDeleted],
      );
      return Promise.all(rows.map((row: { id: number }) => loadRole(pool, row.id)));
    },
  );

  api.get(
    "/api/roles/:roleId",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: { params: roleIdParams, response: { 200: roleResponse } },
    },
    async (req) => loadRole(pool, req.params.roleId),
  );

  api.post(
    "/api/roles",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: {
        summary: "Create a role",
        description:
          "Creates a role at an explicit position strictly below the actor's own highest role (H8). Optionally seeded from an H8 template's capability set, or from an explicit tri-state capability list.",
        body: z.object({
          name: z.string().min(1).max(200),
          position: z.number().int(),
          isVisible: z.boolean().default(true),
          // H8 full-replacement: a freshly created custom role defaults to
          // 'staff' — an operational role an admin adds is staff-like unless
          // told otherwise (matches the roles.badge_category column DEFAULT).
          badgeCategory: badgeCategory.default("staff"),
          templateKey: z.string().min(1).max(120).optional(),
          capabilities: z
            .array(z.object({ capability: z.string().min(1), state: permissionState }))
            .default([]),
        }),
        response: { 201: roleResponse },
      },
    },
    async (req, reply) => {
      const { name, position, isVisible, templateKey } = req.body;
      const roleBadgeCategory = req.body.badgeCategory;
      assertNotSuperadminRole(name);
      let capabilities = req.body.capabilities;
      if (templateKey) {
        const template = getPermissionGroupTemplate(templateKey);
        if (!template) throw new NotFoundError("Role template not found", { templateKey });
        capabilities = template.capabilities.map((capability) => ({
          capability,
          state: "allow" as const,
        }));
      }
      assertKnownCapabilities(capabilities.map((c) => c.capability));
      const role = await withTransaction(async (client) => {
        await lockRoleGraph(client);
        const actorId = req.userId as number;
        await requireRoleMutationAuthority(client, actorId, position);
        if (
          capabilities.some((c) => c.capability === CAPABILITIES.ADMIN_ALL && c.state === "allow")
        ) {
          await requireWildcardRoleAuthority(client, actorId);
        }
        const { rows: existing } = await client.query(`SELECT id FROM roles WHERE name = $1`, [
          name,
        ]);
        if (existing.length > 0) {
          throw new ConflictError("A role with this name already exists", { name });
        }
        const { rows } = await client.query(
          `INSERT INTO roles (name, position, is_visible, badge_category)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [name, position, isVisible, roleBadgeCategory],
        );
        const roleId = rows[0].id as number;
        for (const { capability, state } of capabilities) {
          await client.query(
            `INSERT INTO role_capabilities (role_id, capability, state) VALUES ($1, $2, $3)`,
            [roleId, capability, state],
          );
        }
        const created = await loadRole(client, roleId);
        await audit(client, {
          actorId,
          entityType: "role",
          entityId: roleId,
          action: "create",
          source: "admin",
          after: created,
        });
        return created;
      });
      announceRoleChange();
      return reply.code(201).send(role);
    },
  );

  api.patch(
    "/api/roles/:roleId",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: {
        summary: "Rename, toggle visibility, or recategorize a role",
        description:
          "Updates a role's name, is_visible, and/or badge_category (H8) — the badge/wallet/scanner display bucket this role's holders render as, independent of the role's own name.",
        params: roleIdParams,
        body: z.object({
          name: z.string().min(1).max(200).optional(),
          isVisible: z.boolean().optional(),
          badgeCategory: badgeCategory.optional(),
        }),
        response: { 200: roleResponse },
      },
    },
    async (req) => {
      const { roleId } = req.params;
      const role = await withTransaction(async (client) => {
        await lockRoleGraph(client);
        const before = await loadRole(client, roleId);
        assertNotSuperadminRole(before.name);
        await requireRoleMutationAuthority(client, req.userId as number, before.position);
        const name = req.body.name ?? before.name;
        assertNotSuperadminRole(name);
        const isVisible = req.body.isVisible ?? before.isVisible;
        const nextBadgeCategory = req.body.badgeCategory ?? before.badgeCategory;
        await client.query(
          `UPDATE roles SET name = $2, is_visible = $3, badge_category = $4 WHERE id = $1`,
          [roleId, name, isVisible, nextBadgeCategory],
        );
        await audit(client, {
          actorId: req.userId,
          entityType: "role",
          entityId: roleId,
          action: "update",
          source: "admin",
          before: {
            name: before.name,
            isVisible: before.isVisible,
            badgeCategory: before.badgeCategory,
          },
          after: { name, isVisible, badgeCategory: nextBadgeCategory },
        });
        return loadRole(client, roleId);
      });
      announceRoleChange();
      return role;
    },
  );

  api.patch(
    "/api/roles/:roleId/position",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: {
        summary: "Reorder a role",
        description:
          "Moves a role to an explicit new position (H8). Both the role's current and new position must sit strictly below the actor's own highest role; a position already in use 409s so the client can retry with a different gap value.",
        params: roleIdParams,
        body: z.object({ position: z.number().int() }),
        response: { 200: roleResponse },
      },
    },
    async (req) => {
      const { roleId } = req.params;
      const role = await withTransaction(async (client) => {
        await lockRoleGraph(client);
        const actorId = req.userId as number;
        const before = await loadRole(client, roleId);
        assertNotSuperadminRole(before.name);
        await requireRoleMutationAuthority(client, actorId, before.position);
        await requireRoleMutationAuthority(client, actorId, req.body.position);
        const { rows: collision } = await client.query(
          `SELECT id FROM roles WHERE position = $1 AND id <> $2`,
          [req.body.position, roleId],
        );
        if (collision.length > 0) {
          throw new ConflictError("Another role already occupies this position", {
            position: req.body.position,
          });
        }
        await client.query(`UPDATE roles SET position = $2 WHERE id = $1`, [
          roleId,
          req.body.position,
        ]);
        await audit(client, {
          actorId,
          entityType: "role",
          entityId: roleId,
          action: "reorder",
          source: "admin",
          before: { position: before.position },
          after: { position: req.body.position },
        });
        return loadRole(client, roleId);
      });
      announceRoleChange();
      return role;
    },
  );

  api.put(
    "/api/roles/:roleId/capabilities",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: {
        summary: "Replace a role's tri-state capability grants",
        description:
          "Replaces every explicit ALLOW/DENY/INHERIT row for this role (H8). A capability omitted from the body reverts to the implicit INHERIT default.",
        params: roleIdParams,
        body: z.object({
          capabilities: z.array(
            z.object({ capability: z.string().min(1), state: permissionState }),
          ),
        }),
        response: { 200: roleResponse },
      },
    },
    async (req) => {
      const { roleId } = req.params;
      assertKnownCapabilities(req.body.capabilities.map((c) => c.capability));
      const result = await withTransaction(async (client) => {
        await lockRoleGraph(client);
        const actorId = req.userId as number;
        const before = await loadRole(client, roleId);
        assertNotSuperadminRole(before.name);
        await requireRoleMutationAuthority(client, actorId, before.position);
        // H8: independent, second guard — the actor may only set a capability
        // to ALLOW/DENY if they possess it themselves (or hold the wildcard).
        await requireCapabilityPossessionForStateChange(client, actorId, req.body.capabilities);
        const introducesWildcard = req.body.capabilities.some(
          (c) => c.capability === CAPABILITIES.ADMIN_ALL && c.state === "allow",
        );
        const hadWildcard = await roleGrantsWildcard(client, roleId);
        if (introducesWildcard || hadWildcard) await requireWildcardRoleAuthority(client, actorId);
        await client.query(`DELETE FROM role_capabilities WHERE role_id = $1`, [roleId]);
        for (const { capability, state } of req.body.capabilities) {
          if (state === "inherit") continue; // matches the implicit default: no row needed
          await client.query(
            `INSERT INTO role_capabilities (role_id, capability, state) VALUES ($1, $2, $3)`,
            [roleId, capability, state],
          );
        }
        await audit(client, {
          actorId,
          entityType: "role",
          entityId: roleId,
          action: "set_capabilities",
          source: "admin",
          before: { capabilities: before.capabilities },
          after: { capabilities: req.body.capabilities },
        });
        if (hadWildcard && !introducesWildcard) await assertActiveWildcardHolder(client);
        return loadRole(client, roleId);
      });
      announceRoleChange();
      return result;
    },
  );

  api.delete(
    "/api/roles/:roleId",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: {
        summary: "Soft-delete a role",
        description:
          "Soft-deletes a role (H8, 0804): sets deleted_at instead of removing the row, so its history, capability set, and member list survive for POST .../restore. A deleted role stops granting access immediately. Every default role (Platform administrator included) is deletable this way — the only role this route always refuses is system:superadmin, which is CLI-only.",
        params: roleIdParams,
        response: { 200: z.object({ deleted: z.literal(true) }) },
      },
    },
    async (req) => {
      const { roleId } = req.params;
      await withTransaction(async (client) => {
        await lockRoleGraph(client);
        const before = await loadRole(client, roleId);
        assertNotSuperadminRole(before.name);
        if (before.deletedAt) throw new ConflictError("Role is already deleted", { roleId });
        const actorId = req.userId as number;
        await requireRoleMutationAuthority(client, actorId, before.position);
        const removesWildcard = await roleGrantsWildcard(client, roleId);
        await client.query(`UPDATE roles SET deleted_at = now() WHERE id = $1`, [roleId]);
        if (removesWildcard) await assertActiveWildcardHolder(client);
        await audit(client, {
          actorId,
          entityType: "role",
          entityId: roleId,
          action: "soft_delete",
          source: "admin",
          before,
        });
      });
      announceRoleChange();
      return { deleted: true as const };
    },
  );

  api.post(
    "/api/roles/:roleId/restore",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: {
        summary: "Restore a soft-deleted role",
        description:
          "Clears deleted_at on a soft-deleted role (H8, 0804), reinstating its capability grants and member list immediately. The role keeps its original position; if another role has since taken that exact slot, this 409s instead of silently picking a new one — move the colliding role, or the one being restored, via PATCH .../position first, then retry.",
        params: roleIdParams,
        response: { 200: roleResponse },
      },
    },
    async (req) => {
      const { roleId } = req.params;
      const result = await withTransaction(async (client) => {
        await lockRoleGraph(client);
        const actorId = req.userId as number;
        const before = await loadRole(client, roleId);
        assertNotSuperadminRole(before.name);
        if (!before.deletedAt) throw new ConflictError("Role is not deleted", { roleId });
        await requireRoleMutationAuthority(client, actorId, before.position);
        const { rows: collision } = await client.query(
          `SELECT id FROM roles WHERE position = $1 AND id <> $2 AND deleted_at IS NULL`,
          [before.position, roleId],
        );
        if (collision.length > 0) {
          throw new ConflictError(
            "Another role has since taken this role's position; move one of them before restoring",
            { position: before.position },
          );
        }
        await client.query(`UPDATE roles SET deleted_at = NULL WHERE id = $1`, [roleId]);
        await audit(client, {
          actorId,
          entityType: "role",
          entityId: roleId,
          action: "restore",
          source: "admin",
          after: { roleId },
        });
        return loadRole(client, roleId);
      });
      announceRoleChange();
      return result;
    },
  );

  // ── seeded-role reset to default (H8) ───────────────────────────────────

  api.get(
    "/api/roles/:roleId/seed-diff",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: {
        summary: "Compare a seeded role against its seed-time snapshot",
        description:
          "Reports whether this role is one of the seeded defaults (0801 Sponsor / 0805 catalogue, is_seeded=true) and, if so, whether its live role_capabilities have drifted from the ALLOW set it was seeded with (role_seed_defaults, 0807). `diff` lists every capability whose current tri-state differs from its seed-time state (missing on either side reads as 'inherit'); empty/isSeeded=false for a non-seeded or custom role, since neither carries a snapshot to compare against.",
        params: roleIdParams,
        response: { 200: seedDiffResponse },
      },
    },
    async (req) => {
      const { roleId } = req.params;
      const role = await loadRole(pool, roleId);
      if (!role.isSeeded) return { isSeeded: false, hasDrifted: false, diff: [] };
      const { rows } = await pool.query(
        `SELECT capabilities FROM role_seed_defaults WHERE role_id = $1`,
        [roleId],
      );
      if (rows.length === 0) return { isSeeded: true, hasDrifted: false, diff: [] };
      const defaults = rows[0].capabilities as Record<string, "allow" | "deny" | "inherit">;
      const current = new Map(role.capabilities.map((c) => [c.capability, c.state]));
      const defaultMap = new Map(Object.entries(defaults));
      const caps = new Set([...current.keys(), ...defaultMap.keys()]);
      const diff = [...caps]
        .map((capability) => ({
          capability,
          current: current.get(capability) ?? ("inherit" as const),
          default: defaultMap.get(capability) ?? ("inherit" as const),
        }))
        .filter((entry) => entry.current !== entry.default)
        .sort((a, b) => a.capability.localeCompare(b.capability));
      return { isSeeded: true, hasDrifted: diff.length > 0, diff };
    },
  );

  api.post(
    "/api/roles/:roleId/reset-to-default",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: {
        summary: "Reset a seeded role's capabilities to its seed-time snapshot",
        description:
          "Replaces this role's live role_capabilities with exactly its role_seed_defaults snapshot (H8, 0807) — the ALLOW set it was seeded with; nothing outside that set survives, everything else reverts to implicit INHERIT. Only valid for is_seeded=true roles that still carry a snapshot; system:superadmin is never seeded so this always 404s/403s for it. Guarded the same as PUT .../capabilities: the actor's highest role must sit above this role's position, and — since a reset can re-grant capabilities the role had drifted away from — the actor must already possess every capability that would newly become ALLOW as a result of the reset (or hold the wildcard). That means an admin who lost a capability since this role's last edit cannot use reset to hand it back to themselves via this role; they would need someone who still holds it to do so, or to edit the role's capabilities directly for whichever subset they do possess.",
        params: roleIdParams,
        response: { 200: roleResponse },
      },
    },
    async (req) => {
      const { roleId } = req.params;
      const result = await withTransaction(async (client) => {
        await lockRoleGraph(client);
        const actorId = req.userId as number;
        const before = await loadRole(client, roleId);
        assertNotSuperadminRole(before.name);
        if (!before.isSeeded) {
          throw new BadRequestError("Only a seeded default role can be reset to default", {
            roleId,
          });
        }
        if (before.deletedAt) {
          throw new ConflictError("Restore this role before resetting its capabilities", {
            roleId,
          });
        }
        const { rows: snapshotRows } = await client.query(
          `SELECT capabilities FROM role_seed_defaults WHERE role_id = $1`,
          [roleId],
        );
        if (snapshotRows.length === 0) {
          throw new NotFoundError("This role has no seed snapshot to reset to", { roleId });
        }
        const defaults = snapshotRows[0].capabilities as Record<string, "allow">;
        await requireRoleMutationAuthority(client, actorId, before.position);
        // H8: possession guard applies only to capabilities the reset would
        // newly grant — one already ALLOW on the live role isn't "new".
        const currentAllow = new Set(
          before.capabilities.filter((c) => c.state === "allow").map((c) => c.capability),
        );
        const newlyAllow = Object.keys(defaults).filter((cap) => !currentAllow.has(cap));
        await requireCapabilityPossessionForStateChange(
          client,
          actorId,
          newlyAllow.map((capability) => ({ capability, state: "allow" as const })),
        );
        const introducesWildcard = Object.hasOwn(defaults, CAPABILITIES.ADMIN_ALL);
        const hadWildcard = await roleGrantsWildcard(client, roleId);
        if (introducesWildcard || hadWildcard) await requireWildcardRoleAuthority(client, actorId);
        await client.query(`DELETE FROM role_capabilities WHERE role_id = $1`, [roleId]);
        const afterCapabilities = Object.entries(defaults).map(([capability, state]) => ({
          capability,
          state,
        }));
        for (const { capability, state } of afterCapabilities) {
          await client.query(
            `INSERT INTO role_capabilities (role_id, capability, state) VALUES ($1, $2, $3)`,
            [roleId, capability, state],
          );
        }
        await audit(client, {
          actorId,
          entityType: "role",
          entityId: roleId,
          action: "reset_to_default",
          source: "admin",
          before: { capabilities: before.capabilities },
          after: { capabilities: afterCapabilities },
        });
        if (hadWildcard && !introducesWildcard) await assertActiveWildcardHolder(client);
        return loadRole(client, roleId);
      });
      announceRoleChange();
      return result;
    },
  );

  // ── user assignment ──────────────────────────────────────────────────────

  api.post(
    "/api/roles/:roleId/users/:userId",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: {
        summary: "Assign a role to a user",
        params: z.object({
          roleId: z.coerce.number().int(),
          userId: z.coerce.number().int(),
        }),
        response: { 200: roleResponse },
      },
    },
    async (req) => {
      const { roleId, userId } = req.params;
      const result = await withTransaction(async (client) => {
        await lockRoleGraph(client);
        const actorId = req.userId as number;
        const role = await loadRole(client, roleId);
        assertNotSuperadminRole(role.name);
        await requireRoleMutationAuthority(client, actorId, role.position);
        // H8: independent, second guard — the actor may only assign a role
        // whose own explicit ALLOWs they already possess (or hold the wildcard).
        await requireCapabilityPossessionForAssignment(client, actorId, roleId);
        const { rows: userRows } = await client.query(
          `SELECT id FROM users
            WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
            FOR UPDATE`,
          [userId],
        );
        if (userRows.length === 0) throw new NotFoundError("User not found", { userId });
        await client.query(
          `INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [userId, roleId, actorId],
        );
        // A capability holder is staff (H8); issue their permanent entrance
        // ticket in the same transaction as the role-producing assignment.
        if (await userHasAnyCapability(client, userId)) await issueTicket(client, userId);
        await audit(client, {
          actorId,
          entityType: "role",
          entityId: roleId,
          action: "assign_user",
          source: "admin",
          after: { userId },
        });
        return loadRole(client, roleId);
      });
      announceRoleChange();
      return result;
    },
  );

  api.delete(
    "/api/roles/:roleId/users/:userId",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: {
        summary: "Remove a role from a user",
        params: z.object({
          roleId: z.coerce.number().int(),
          userId: z.coerce.number().int(),
        }),
        response: { 200: roleResponse },
      },
    },
    async (req) => {
      const { roleId, userId } = req.params;
      const result = await withTransaction(async (client) => {
        await lockRoleGraph(client);
        const actorId = req.userId as number;
        const role = await loadRole(client, roleId);
        assertNotSuperadminRole(role.name);
        await requireRoleMutationAuthority(client, actorId, role.position);
        const removesWildcard = await roleGrantsWildcard(client, roleId);
        await client.query(`DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2`, [
          userId,
          roleId,
        ]);
        if (removesWildcard) await assertActiveWildcardHolder(client, undefined);
        await audit(client, {
          actorId,
          entityType: "role",
          entityId: roleId,
          action: "remove_user",
          source: "admin",
          before: { userId },
        });
        return loadRole(client, roleId);
      });
      announceRoleChange();
      return result;
    },
  );

  api.get(
    "/api/users/:userId/roles",
    {
      preHandler: readRoles,
      config: routeAccess({
        kind: "capability",
        anyOf: [CAPABILITIES.PERMISSIONS_MANAGE, CAPABILITIES.INVITES_MANAGE],
      }),
      schema: {
        summary: "List a user's assigned roles",
        params: z.object({ userId: z.coerce.number().int() }),
        response: {
          200: z.array(
            z.object({
              id: z.number(),
              name: z.string(),
              position: z.number(),
              isVisible: z.boolean(),
            }),
          ),
        },
      },
    },
    async (req) => {
      const { rows } = await pool.query(
        `SELECT r.id, r.name, r.position, r.is_visible
           FROM user_roles ur
           JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = $1
          ORDER BY r.position DESC`,
        [req.params.userId],
      );
      return rows.map((r: Record<string, unknown>) => ({
        id: r.id as number,
        name: r.name as string,
        position: r.position as number,
        isVisible: r.is_visible as boolean,
      }));
    },
  );

  api.get(
    "/api/roles/capability-catalogue",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.PERMISSIONS_MANAGE }),
      schema: {
        summary: "List every known capability",
        description: "The full shared capability catalogue (H8), for the role capability editor.",
        response: { 200: z.array(z.string()) },
      },
    },
    async () => [...ALL_CAPABILITIES],
  );
}
