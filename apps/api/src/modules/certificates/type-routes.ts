import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { requireAuth, requireCapability } from "../../lib/capabilities.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { routeAccessOption } from "../../lib/route-policy.js";
import { fixtureReadFilter } from "../logistics/review-fixture-scope.js";
import { issueConfiguredCertificate, issueForSelf, listIssuedCertificates } from "./service.js";
import {
  listCertificateTypes,
  readCertificateType,
  saveCertificateType,
  typeInputSchema,
} from "./types.js";

/** #1083: definitions and the durable register for account and guest documents. */
export function registerCertificateTypeRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const staff = requireCapability(CAPABILITIES.PRESENCE_MANAGE);
  const access = routeAccessOption({
    kind: "capability",
    capability: CAPABILITIES.PRESENCE_MANAGE,
  });
  r.get(
    "/api/certificates/types",
    {
      ...access,
      preHandler: staff,
      schema: {
        summary: "Certificate definitions and recipient roles",
        description:
          "All configured certificate types, their trilingual text, actual recipient-role IDs, identity policy, guest/self-service options, event-end and presentation requirements and exempt roles. Includes the active role and challenge catalogues for the settings editor (#1083).",
      },
    },
    async () => {
      const roles = await pool.query(
        `SELECT id,name FROM roles WHERE deleted_at IS NULL ORDER BY position DESC,id`,
      );
      const challenges = await pool.query(
        `SELECT id,title,mandatory FROM challenges ORDER BY mandatory DESC,title,id`,
      );
      return {
        items: await listCertificateTypes(),
        roles: roles.rows,
        challenges: challenges.rows,
      };
    },
  );
  r.post(
    "/api/certificates/types",
    {
      ...access,
      preHandler: [staff, idempotencyGuard],
      schema: {
        body: typeInputSchema,
        summary: "Create a configurable certificate type",
        description:
          "Creates an audited trilingual certificate definition. Content fields are recipient, event, issuer, activity, hours, dates and venue. Recipient roles use stored role membership; guests and identification are explicit options. Nothing is issued by creating a definition (#1083, H53).",
      },
    },
    async (req) => saveCertificateType(req.userId as number, req.body),
  );
  r.put(
    "/api/certificates/types/:typeId",
    {
      ...access,
      preHandler: [staff, idempotencyGuard],
      schema: {
        params: z.object({ typeId: z.coerce.number().int().positive() }),
        body: z.object({ revision: z.number().int().positive(), definition: typeInputSchema }),
        summary: "Edit a certificate definition",
        description:
          "Replaces the definition under an optimistic revision check and row lock. Existing issued content remains frozen. Disabled types cannot issue new documents; their issued documents remain searchable and revocable (#1083, H53).",
      },
    },
    async (req) =>
      saveCertificateType(
        req.userId as number,
        req.body.definition,
        req.params.typeId,
        req.body.revision,
      ),
  );
  r.get(
    "/api/certificates/recipients",
    {
      ...access,
      preHandler: staff,
      schema: {
        querystring: z.object({ q: z.string().max(200).default("") }),
        summary: "Find an account for certificate issuance",
        description:
          "Active real/test-scoped accounts searched by name or email. Certificate managers can find staff, participants, sponsors and mentors without needing the unrelated role editor capability (#1083).",
      },
    },
    async (req) => {
      const scope = await fixtureReadFilter(pool, req.userId as number, "u");
      const { rows } = await pool.query(
        `SELECT u.id,u.name,u.surname,u.email FROM users u WHERE u.account_state='active' AND u.anonymized_at IS NULL ${scope} AND (concat_ws(' ',u.name,u.surname) ILIKE $1 OR u.email ILIKE $1) ORDER BY u.name,u.surname,u.id LIMIT 30`,
        [`%${req.query.q}%`],
      );
      return { items: rows };
    },
  );
  r.post(
    "/api/certificates/issue",
    {
      ...access,
      preHandler: [staff, idempotencyGuard],
      schema: {
        body: z
          .object({
            typeId: z.number().int().positive(),
            locale: z.enum(["es", "gl", "en"]),
            userId: z.number().int().positive().optional(),
            guestName: z.string().trim().min(1).max(400).optional(),
            includeIdentification: z.boolean().optional(),
            documentKind: z.enum(["dni_nie", "passport"]).optional(),
            documentNumber: z.string().trim().min(1).max(100).optional(),
            activityName: z.string().trim().max(500).optional(),
            certifiedHours: z.number().positive().max(999).optional(),
            overrideReason: z.string().trim().min(1).max(2000).optional(),
            refresh: z.boolean().optional(),
          })
          .strict(),
        summary: "Issue a configured certificate to an account or guest",
        description:
          "Choose exactly one account or guest name. Enforces the definition's recipient roles, guest permission, required activity and identification policy. Optional DNI/NIE/passport is never returned by verification JSON. Guest documents persist in the event-settings register for searching, redownloading and revocation. Audited and idempotent (#1083, H53).",
      },
    },
    async (req) => issueConfiguredCertificate(req.userId as number, req.body),
  );
  r.post(
    "/api/me/certificates/issue",
    {
      config: { routeAccessPolicy: { kind: "authenticated" } },
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        body: z.object({
          typeId: z.number().int().positive(),
          locale: z.enum(["es", "gl", "en"]),
          refresh: z.boolean().optional(),
        }),
        summary: "Obtain an eligible configured certificate",
        description:
          "Enabled self-service definitions require event access and matching recipient criteria. Accepted spot is predefined for everyone with event access, without hours or demo requirements. Attendance types additionally enforce the attendance policy. Speaker/activity-specific certificates must be issued by staff. `refresh: true` replaces the current document with a new one, without revoking it, when the hours or activities it states changed after more attendance; otherwise it returns the current one (#1083).",
      },
    },
    async (req) => {
      const type = await readCertificateType(req.body.typeId);
      return issueForSelf(
        req.userId as number,
        type.legacyVariant === "accepted_spot"
          ? "participation"
          : (type.legacyVariant ?? "participation"),
        req.body.locale,
        type.id,
        req.body.refresh,
      );
    },
  );
  r.get(
    "/api/certificates/issued",
    {
      ...access,
      preHandler: staff,
      schema: {
        summary: "Searchable issued-certificate register",
        description:
          "Persistent event-settings register of issued account and guest certificates, including revoked documents. Returns names, type, activity, code and lifecycle metadata, never identification numbers. Staff use the existing PDF/revoke endpoints to redownload or revoke any live guest document (#1083).",
      },
    },
    async (req) => ({ items: await listIssuedCertificates(req.userId as number) }),
  );
}
