import { randomBytes } from "node:crypto";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool, type Queryable, withTransaction } from "../../../db/pool.js";
import { audit } from "../../../lib/audit.js";
import { requireCapability } from "../../../lib/capabilities.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../../lib/errors.js";
import { routeAccessConfig as routeAccess } from "../../../lib/route-policy.js";
import {
  lockRoleGraph,
  requireWildcardInviteAuthority,
  roleIdsGrantCapability,
} from "../invite-role-authority.js";
import { enterpriseInviteClaimUrl } from "./enterprise-invite-links.js";

export type UserInviteLinkKind = "staff" | "sponsor" | "participant";

export interface UserInviteLinkRow {
  id: number;
  token: string;
  kind: UserInviteLinkKind;
  enterprise_id: number | null;
  group_ids: number[];
  wildcard_authorized: boolean;
  max_redeems: number | null;
  redeemed_count: number;
  expires_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

export function userInviteLinkIsExpired(
  link: Pick<UserInviteLinkRow, "expires_at" | "revoked_at" | "max_redeems" | "redeemed_count">,
  now = new Date(),
): boolean {
  return (
    link.revoked_at !== null ||
    (link.expires_at !== null && link.expires_at <= now) ||
    (link.max_redeems !== null && link.redeemed_count >= link.max_redeems)
  );
}

export async function findUserInviteLink(
  db: Queryable,
  token: string,
  lock = false,
): Promise<UserInviteLinkRow | undefined> {
  const { rows } = await db.query(
    `SELECT id, token, kind, enterprise_id, group_ids, wildcard_authorized,
            max_redeems, redeemed_count, expires_at, revoked_at, created_at
       FROM user_invite_links
      WHERE token = $1${lock ? " FOR UPDATE" : ""}`,
    [token],
  );
  return rows[0] as UserInviteLinkRow | undefined;
}

const userInviteLinkStatus = z.enum(["active", "expired", "exhausted", "withdrawn"]);
const inviteKind = z.enum(["staff", "sponsor", "participant"]);

const userInviteLinkResponse = z.object({
  id: z.number(),
  kind: inviteKind,
  enterpriseId: z.number().nullable(),
  enterpriseName: z.string().nullable(),
  groupIds: z.array(z.number()),
  token: z.string(),
  url: z.string(),
  maxRedeems: z.number().nullable(),
  redeemedCount: z.number(),
  remainingRedeems: z.number().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
  status: userInviteLinkStatus,
  redemptions: z.array(
    z.object({
      id: z.number(),
      userId: z.number().nullable(),
      email: z.string(),
      name: z.string().nullable(),
      redeemedAt: z.string(),
    }),
  ),
});

type UserInviteLinkResponse = z.infer<typeof userInviteLinkResponse>;

function statusFor(
  link: Pick<UserInviteLinkRow, "expires_at" | "revoked_at" | "max_redeems" | "redeemed_count">,
  now = new Date(),
): z.infer<typeof userInviteLinkStatus> {
  if (link.revoked_at !== null) return "withdrawn";
  if (link.max_redeems !== null && link.redeemed_count >= link.max_redeems) return "exhausted";
  if (link.expires_at !== null && link.expires_at <= now) return "expired";
  return "active";
}

function toResponse(row: Record<string, unknown>): UserInviteLinkResponse {
  const link = {
    kind: row.kind as UserInviteLinkKind,
    revoked_at: (row.revoked_at as Date | null) ?? null,
    expires_at: (row.expires_at as Date | null) ?? null,
    max_redeems: (row.max_redeems as number | null) ?? null,
    redeemed_count: Number(row.redeemed_count),
  };
  const redemptions = Array.isArray(row.redemptions) ? row.redemptions : [];
  return {
    id: Number(row.id),
    kind: link.kind,
    enterpriseId: row.enterprise_id == null ? null : Number(row.enterprise_id),
    enterpriseName: (row.enterprise_name as string | null) ?? null,
    groupIds: (row.group_ids as number[]) ?? [],
    token: String(row.token),
    url: enterpriseInviteClaimUrl(String(row.token)),
    maxRedeems: link.max_redeems,
    redeemedCount: link.redeemed_count,
    remainingRedeems:
      link.max_redeems === null ? null : Math.max(0, link.max_redeems - link.redeemed_count),
    expiresAt: link.expires_at?.toISOString() ?? null,
    revokedAt: link.revoked_at?.toISOString() ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    status: statusFor(link),
    redemptions: redemptions.map((redemption) => {
      const item = redemption as Record<string, unknown>;
      return {
        id: Number(item.id),
        userId: item.user_id == null ? null : Number(item.user_id),
        email: String(item.email),
        name: (item.name as string | null) ?? null,
        redeemedAt: new Date(item.redeemed_at as string).toISOString(),
      };
    }),
  };
}

async function listLinks(): Promise<UserInviteLinkResponse[]> {
  const { rows } = await pool.query(
    `SELECT l.id, l.token, l.kind, l.enterprise_id, e.name AS enterprise_name,
            l.group_ids, l.max_redeems, l.redeemed_count, l.expires_at,
            l.revoked_at, l.created_at,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', r.id,
                  'user_id', r.user_id,
                  'email', r.email,
                  'name', r.name,
                  'redeemed_at', r.redeemed_at
                ) ORDER BY r.redeemed_at DESC
              ) FILTER (WHERE r.id IS NOT NULL),
              '[]'::json
            ) AS redemptions
       FROM user_invite_links l
       LEFT JOIN enterprises e ON e.id = l.enterprise_id
       LEFT JOIN user_invite_link_redemptions r ON r.link_id = l.id
      GROUP BY l.id, e.name
      ORDER BY l.created_at DESC`,
  );
  return rows.map((row: Record<string, unknown>) => toResponse(row));
}

export function registerUserInviteLinkRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const manage = requireCapability(CAPABILITIES.INVITES_MANAGE);

  api.get(
    "/api/invites/user-links",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.INVITES_MANAGE }),
      schema: {
        response: { 200: z.array(userInviteLinkResponse) },
        summary: "List reusable user invite links",
        description:
          "Lists reusable account-creation links for staff, sponsors, or participants with their limits, status, and redemptions (H10).",
      },
    },
    async () => listLinks(),
  );

  api.post(
    "/api/invites/user-links",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.INVITES_MANAGE }),
      schema: {
        body: z.object({
          kind: inviteKind,
          enterpriseId: z.number().int().positive().optional(),
          groupIds: z.array(z.number().int().positive()).default([]),
          maxRedeems: z.number().int().positive().nullable().default(null),
          // null means no automatic expiry.
          expiresInMinutes: z
            .number()
            .int()
            .positive()
            .nullable()
            .default(7 * 24 * 60),
        }),
        response: { 201: userInviteLinkResponse },
        summary: "Create a reusable user invite link",
        description:
          "Creates a reusable account-creation link. Each claimant supplies their own email; staff links assign roles on acceptance (H10).",
      },
    },
    async (req, reply) => {
      const { kind, enterpriseId, maxRedeems, expiresInMinutes } = req.body;
      const groupIds = [...new Set(req.body.groupIds)];

      if (kind === "sponsor" && enterpriseId === undefined) {
        throw new BadRequestError("Sponsor invite links require enterpriseId");
      }
      if (kind !== "sponsor" && enterpriseId !== undefined) {
        throw new BadRequestError("enterpriseId is only valid for sponsor invite links");
      }
      if (kind !== "staff" && groupIds.length > 0) {
        throw new BadRequestError("Only staff invite links may assign roles");
      }
      if (kind === "staff" && groupIds.length === 0) {
        throw new BadRequestError("Staff invite links require at least one role");
      }

      const token = randomBytes(32).toString("base64url");
      const result = await withTransaction(async (client) => {
        await lockRoleGraph(client);
        const wildcardAuthorized = await requireWildcardInviteAuthority(
          client,
          req.userId as number,
          groupIds,
          { requireExisting: true },
        );
        if (kind === "staff" && !(await roleIdsGrantCapability(client, groupIds))) {
          throw new BadRequestError("Staff invite links require a role with capabilities");
        }

        let enterprise: { id: number; name: string } | undefined;
        if (enterpriseId !== undefined) {
          const { rows } = await client.query(
            `SELECT id, name FROM enterprises WHERE id = $1 FOR SHARE`,
            [enterpriseId],
          );
          enterprise = rows[0] as { id: number; name: string } | undefined;
          if (!enterprise) throw new NotFoundError("Enterprise not found", { enterpriseId });
        }

        const { rows } = await client.query(
          `INSERT INTO user_invite_links
             (token, kind, enterprise_id, created_by, group_ids, wildcard_authorized,
              max_redeems, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7,
                   CASE WHEN $8::integer IS NULL THEN NULL
                        ELSE now() + ($8::integer * interval '1 minute') END)
           RETURNING id, token, kind, enterprise_id, group_ids, wildcard_authorized,
                     max_redeems, redeemed_count, expires_at, revoked_at, created_at`,
          [
            token,
            kind,
            enterpriseId ?? null,
            req.userId,
            groupIds,
            wildcardAuthorized,
            maxRedeems,
            expiresInMinutes,
          ],
        );
        const created = rows[0] as UserInviteLinkRow;
        await audit(client, {
          actorId: req.userId,
          entityType: "user_invite_link",
          entityId: created.id,
          action: "create",
          source: "admin",
          after: {
            kind,
            enterpriseId: enterpriseId ?? null,
            groupIds,
            maxRedeems,
            expiresInMinutes,
          },
        });
        return { ...created, enterprise_name: enterprise?.name ?? null, redemptions: [] };
      });

      return reply.code(201).send(toResponse(result));
    },
  );

  api.post(
    "/api/invites/user-links/:id/withdraw",
    {
      preHandler: manage,
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.INVITES_MANAGE }),
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        response: { 200: z.object({ success: z.literal(true) }) },
        summary: "Withdraw a reusable user invite link",
        description:
          "Immediately prevents further account creation from a reusable user invite link while preserving its redemption history (H10).",
      },
    },
    async (req) => {
      await withTransaction(async (client) => {
        const { rows } = await client.query(
          `SELECT id, kind, enterprise_id, group_ids, max_redeems, redeemed_count,
                  expires_at, revoked_at
             FROM user_invite_links WHERE id = $1 FOR UPDATE`,
          [req.params.id],
        );
        const link = rows[0] as UserInviteLinkRow | undefined;
        if (!link) throw new NotFoundError("User invite link not found", { id: req.params.id });
        if (link.revoked_at !== null) {
          throw new ConflictError("User invite link is already withdrawn", { id: req.params.id });
        }
        await client.query(`UPDATE user_invite_links SET revoked_at = now() WHERE id = $1`, [
          req.params.id,
        ]);
        await audit(client, {
          actorId: req.userId,
          entityType: "user_invite_link",
          entityId: req.params.id,
          action: "withdraw",
          source: "admin",
          before: {
            kind: link.kind,
            enterpriseId: link.enterprise_id,
            groupIds: link.group_ids,
            maxRedeems: link.max_redeems,
            redeemedCount: link.redeemed_count,
            expiresAt: link.expires_at?.toISOString() ?? null,
          },
        });
      });
      return { success: true as const };
    },
  );
}
