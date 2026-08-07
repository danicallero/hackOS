import { randomBytes } from "node:crypto";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { config } from "../../../config.js";
import { pool, type Queryable, withTransaction } from "../../../db/pool.js";
import { audit } from "../../../lib/audit.js";
import { requireAnyCapability } from "../../../lib/capabilities.js";
import { ConflictError, NotFoundError } from "../../../lib/errors.js";
import { routeAccessOption as routeAccess } from "../../../lib/route-policy.js";

export interface EnterpriseInviteLinkRow {
  id: number;
  token: string;
  enterprise_id: number;
  max_redeems: number | null;
  redeemed_count: number;
  expires_at: Date | null;
  revoked_at: Date | null;
  created_at: Date;
}

export function enterpriseInviteLinkIsExpired(
  link: Pick<
    EnterpriseInviteLinkRow,
    "expires_at" | "revoked_at" | "max_redeems" | "redeemed_count"
  >,
  now = new Date(),
): boolean {
  return (
    link.revoked_at !== null ||
    (link.expires_at !== null && link.expires_at <= now) ||
    (link.max_redeems !== null && link.redeemed_count >= link.max_redeems)
  );
}

export async function findEnterpriseInviteLink(
  db: Queryable,
  token: string,
  lock = false,
): Promise<EnterpriseInviteLinkRow | undefined> {
  const { rows } = await db.query(
    `SELECT id, token, enterprise_id, max_redeems, redeemed_count,
            expires_at, revoked_at, created_at
       FROM enterprise_invite_links
      WHERE token = $1${lock ? " FOR UPDATE" : ""}`,
    [token],
  );
  return rows[0] as EnterpriseInviteLinkRow | undefined;
}

export function enterpriseInviteClaimUrl(token: string): string {
  return `${config.WEB_URL}/claim-account?token=${token}`;
}

const enterpriseInviteLinkStatus = z.enum(["active", "expired", "exhausted", "withdrawn"]);

const enterpriseInviteLinkResponse = z.object({
  id: z.number(),
  enterpriseId: z.number(),
  enterpriseName: z.string(),
  token: z.string(),
  url: z.string(),
  maxRedeems: z.number().nullable(),
  redeemedCount: z.number(),
  remainingRedeems: z.number().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  createdAt: z.string(),
  status: enterpriseInviteLinkStatus,
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

type EnterpriseInviteLinkResponse = z.infer<typeof enterpriseInviteLinkResponse>;

function statusFor(
  link: Pick<
    EnterpriseInviteLinkRow,
    "expires_at" | "revoked_at" | "max_redeems" | "redeemed_count"
  >,
  now = new Date(),
): z.infer<typeof enterpriseInviteLinkStatus> {
  if (link.revoked_at !== null) return "withdrawn";
  if (link.max_redeems !== null && link.redeemed_count >= link.max_redeems) return "exhausted";
  if (link.expires_at !== null && link.expires_at <= now) return "expired";
  return "active";
}

function toResponse(row: Record<string, unknown>): EnterpriseInviteLinkResponse {
  const link = {
    revoked_at: (row.revoked_at as Date | null) ?? null,
    expires_at: (row.expires_at as Date | null) ?? null,
    max_redeems: (row.max_redeems as number | null) ?? null,
    redeemed_count: Number(row.redeemed_count),
  };
  const redemptions = Array.isArray(row.redemptions) ? row.redemptions : [];
  return {
    id: Number(row.id),
    enterpriseId: Number(row.enterprise_id),
    enterpriseName: String(row.enterprise_name),
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
        redeemedAt: (item.redeemed_at as Date).toISOString(),
      };
    }),
  };
}

async function listLinks(enterpriseId?: number): Promise<EnterpriseInviteLinkResponse[]> {
  const { rows } = await pool.query(
    `SELECT l.id, l.token, l.enterprise_id, e.name AS enterprise_name,
            l.max_redeems, l.redeemed_count, l.expires_at, l.revoked_at, l.created_at,
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
       FROM enterprise_invite_links l
       JOIN enterprises e ON e.id = l.enterprise_id
       LEFT JOIN enterprise_invite_link_redemptions r ON r.link_id = l.id
      WHERE ($1::integer IS NULL OR l.enterprise_id = $1)
      GROUP BY l.id, e.name
      ORDER BY l.created_at DESC`,
    [enterpriseId ?? null],
  );
  return rows.map((row: Record<string, unknown>) => toResponse(row));
}

export function registerEnterpriseInviteLinkRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const manage = requireAnyCapability(CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.INVITES_MANAGE);
  const policy = {
    kind: "capability" as const,
    anyOf: [CAPABILITIES.SPONSORS_MANAGE, CAPABILITIES.INVITES_MANAGE],
  };

  api.get(
    "/api/invites/enterprise-options",
    {
      ...routeAccess(policy),
      preHandler: manage,
      schema: {
        response: {
          200: z.object({
            enterprises: z.array(z.object({ id: z.number(), name: z.string() })),
          }),
        },
        summary: "List enterprise invite options",
        description:
          "Lists enterprise names that invitation managers can target without exposing enterprise administration (H43).",
      },
    },
    async () => {
      const { rows } = await pool.query(`SELECT id, name FROM enterprises ORDER BY name ASC`);
      return {
        enterprises: rows.map((row: { id: number; name: string }) => ({
          id: Number(row.id),
          name: row.name,
        })),
      };
    },
  );

  api.get(
    "/api/invites/enterprise-links",
    {
      ...routeAccess(policy),
      preHandler: manage,
      schema: {
        querystring: z.object({ enterpriseId: z.coerce.number().int().positive().optional() }),
        response: { 200: z.array(enterpriseInviteLinkResponse) },
        summary: "List enterprise invite links",
        description:
          "Lists reusable enterprise invitation links with their limits, status, and account redemptions (H43).",
      },
    },
    async (req) => listLinks(req.query.enterpriseId),
  );

  api.post(
    "/api/invites/enterprise-links",
    {
      ...routeAccess(policy),
      preHandler: manage,
      schema: {
        body: z.object({
          enterpriseId: z.number().int().positive(),
          maxRedeems: z.number().int().positive().nullable().default(null),
          // `null` means the link never expires. A one-minute link is valid.
          expiresInMinutes: z
            .number()
            .int()
            .positive()
            .nullable()
            .default(7 * 24 * 60),
        }),
        response: { 201: enterpriseInviteLinkResponse },
        summary: "Create an enterprise invite link",
        description:
          "Creates a reusable account-creation link for an enterprise with an optional redemption limit and expiry (H43).",
      },
    },
    async (req, reply) => {
      const { enterpriseId, maxRedeems, expiresInMinutes } = req.body;
      const token = randomBytes(32).toString("base64url");
      const result = await withTransaction(async (client) => {
        const { rows: enterprises } = await client.query(
          `SELECT id, name FROM enterprises WHERE id = $1 FOR SHARE`,
          [enterpriseId],
        );
        const enterprise = enterprises[0] as { id: number; name: string } | undefined;
        if (!enterprise) throw new NotFoundError("Enterprise not found", { enterpriseId });

        const { rows } = await client.query(
          `INSERT INTO enterprise_invite_links
             (token, enterprise_id, created_by, max_redeems, expires_at)
           VALUES ($1, $2, $3, $4,
                   CASE WHEN $5::integer IS NULL THEN NULL
                        ELSE now() + ($5::integer * interval '1 minute') END)
           RETURNING id, token, enterprise_id, max_redeems, redeemed_count,
                     expires_at, revoked_at, created_at`,
          [token, enterpriseId, req.userId, maxRedeems, expiresInMinutes],
        );
        const created = rows[0] as EnterpriseInviteLinkRow;
        await audit(client, {
          actorId: req.userId,
          entityType: "enterprise_invite_link",
          entityId: created.id,
          action: "create",
          source: "admin",
          after: {
            enterpriseId,
            maxRedeems,
            expiresInMinutes,
          },
        });
        return { ...created, enterprise_name: enterprise.name, redemptions: [] };
      });

      return reply.code(201).send(toResponse(result));
    },
  );

  api.post(
    "/api/invites/enterprise-links/:id/withdraw",
    {
      ...routeAccess(policy),
      preHandler: manage,
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        response: { 200: z.object({ success: z.literal(true) }) },
        summary: "Withdraw an enterprise invite link",
        description:
          "Immediately prevents further account creation from an enterprise invite link (H43).",
      },
    },
    async (req) => {
      await withTransaction(async (client) => {
        const { rows } = await client.query(
          `SELECT id, enterprise_id, max_redeems, redeemed_count, expires_at, revoked_at
             FROM enterprise_invite_links WHERE id = $1 FOR UPDATE`,
          [req.params.id],
        );
        const link = rows[0] as EnterpriseInviteLinkRow | undefined;
        if (!link)
          throw new NotFoundError("Enterprise invite link not found", { id: req.params.id });
        if (link.revoked_at !== null) {
          throw new ConflictError("Enterprise invite link is already withdrawn", {
            id: req.params.id,
          });
        }
        await client.query(`UPDATE enterprise_invite_links SET revoked_at = now() WHERE id = $1`, [
          req.params.id,
        ]);
        await audit(client, {
          actorId: req.userId,
          entityType: "enterprise_invite_link",
          entityId: req.params.id,
          action: "withdraw",
          source: "admin",
          before: {
            enterpriseId: link.enterprise_id,
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
