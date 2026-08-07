import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth, requireCapability } from "../../lib/capabilities.js";
import { BadRequestError, ForbiddenError, UnauthorizedError } from "../../lib/errors.js";
import { routeAccessOption as access } from "../../lib/route-policy.js";
import { putObject } from "../../lib/storage.js";
import { enterpriseAccessFor, requireEnterpriseAccess } from "./access.js";
import {
  addMemberBody,
  bulkVisibilityBody,
  CONTENT_TYPE_EXT,
  createEnterpriseBody,
  enterpriseIdParam,
  memberParams,
  OWNER_EDITABLE_KEYS,
  updateEnterpriseBody,
} from "./schemas.js";
import {
  addEnterpriseMember,
  createEnterprise,
  getEnterprise,
  listEnterpriseMembers,
  listEnterprises,
  listPublicSponsors,
  listUserEnterprises,
  myEnterprise,
  removeEnterpriseMember,
  setEnterpriseLogo,
  setEnterprisesVisibility,
  updateEnterprise,
} from "./service.js";

function actor(userId: number | null): number {
  if (userId == null) throw new UnauthorizedError();
  return userId;
}

const enterpriseParam = { source: "params", field: "id" } as const;

/**
 * H43-H45: enterprise (sponsor) management and the public sponsor reveal.
 * Admins manage every enterprise incl. visibility/priority; sponsor reps edit
 * only their own profile. The public list is anonymous and driven by the
 * enterprise's own visibility window.
 */
export function registerSponsorRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const manage = requireCapability(CAPABILITIES.SPONSORS_MANAGE);

  // Public logo grid for the website / TV.
  r.get(
    "/api/public/sponsors",
    {
      ...access({ kind: "public", anonymousCategory: "public-content" }),
      schema: {
        summary: "List public sponsors",
        description: "Returns visible sponsor enterprises for the public event site (H45).",
      },
    },
    async () => ({ items: await listPublicSponsors() }),
  );

  r.get(
    "/api/enterprises",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.SPONSORS_MANAGE }),
      preHandler: manage,
      schema: {
        summary: "List enterprises",
        description: "Lists all sponsor enterprises for global sponsor administrators (H43).",
      },
    },
    async () => ({
      enterprises: await listEnterprises(),
    }),
  );

  r.post(
    "/api/enterprises",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.SPONSORS_MANAGE }),
      preHandler: manage,
      schema: {
        body: createEnterpriseBody,
        summary: "Create an enterprise",
        description: "Creates a sponsor enterprise under global sponsor administration (H43).",
      },
    },
    async (req, reply) => {
      const created = await createEnterprise(req.body, req.userId);
      reply.code(201);
      return created;
    },
  );

  // Admin bulk visibility flip from the enterprises list (H45).
  r.post(
    "/api/enterprises/visibility",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.SPONSORS_MANAGE }),
      preHandler: manage,
      schema: {
        body: bulkVisibilityBody,
        summary: "Set enterprise visibility",
        description: "Globally reveals or hides sponsor enterprises (H45).",
      },
    },
    async (req) => setEnterprisesVisibility(req.body.ids, req.body.visible, req.userId),
  );

  // Sponsor rep's own enterprise (H44).
  r.get(
    "/api/enterprises/mine",
    {
      ...access({ kind: "authenticated" }),
      preHandler: requireAuth,
      schema: {
        summary: "Get my enterprise",
        description: "Returns the caller's sponsor enterprise affiliation (H44).",
      },
    },
    async (req) => myEnterprise(actor(req.userId)),
  );

  r.get(
    "/api/enterprises/:id",
    {
      ...access({ kind: "contextual", policy: "enterprise-access", resource: enterpriseParam }),
      preHandler: requireEnterpriseAccess(enterpriseParam),
      schema: {
        params: enterpriseIdParam,
        summary: "Get a scoped enterprise",
        description:
          "Accessible to its sponsor representatives or a global sponsor administrator (H44).",
      },
    },
    async (req) => {
      return getEnterprise(req.params.id);
    },
  );

  r.patch(
    "/api/enterprises/:id",
    {
      ...access({ kind: "contextual", policy: "enterprise-access", resource: enterpriseParam }),
      preHandler: requireEnterpriseAccess(enterpriseParam),
      schema: {
        params: enterpriseIdParam,
        body: updateEnterpriseBody,
        summary: "Update a scoped enterprise",
        description:
          "Sponsor representatives may update their profile fields; global administrators may update all enterprise fields (H44).",
      },
    },
    async (req) => {
      if (enterpriseAccessFor(req) === "owner") {
        const disallowed = Object.keys(req.body).filter(
          (k) => !OWNER_EDITABLE_KEYS.includes(k as (typeof OWNER_EDITABLE_KEYS)[number]),
        );
        if (disallowed.length > 0)
          throw new ForbiddenError(
            `Sponsors may only edit ${OWNER_EDITABLE_KEYS.join(", ")}; not ${disallowed.join(", ")}`,
            { disallowed },
          );
      }
      return updateEnterprise(req.params.id, req.body, req.userId);
    },
  );

  // ── M4: enterprise membership (the affiliated users) ────────────────────────
  r.get(
    "/api/enterprises/:id/members",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.SPONSORS_MANAGE }),
      preHandler: manage,
      schema: {
        params: enterpriseIdParam,
        summary: "List enterprise members",
        description: "Lists sponsor affiliations for a globally managed enterprise (H43).",
      },
    },
    async (req) => ({ members: await listEnterpriseMembers(req.params.id) }),
  );

  r.post(
    "/api/enterprises/:id/members",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.SPONSORS_MANAGE }),
      preHandler: manage,
      schema: {
        params: enterpriseIdParam,
        body: addMemberBody,
        summary: "Add enterprise member",
        description:
          "Affiliates an account with an enterprise under global sponsor administration (H43).",
      },
    },
    async (req, reply) => {
      const member = await addEnterpriseMember(req.params.id, req.body.userId, req.userId);
      reply.code(201);
      return member;
    },
  );

  r.delete(
    "/api/enterprises/:id/members/:userId",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.SPONSORS_MANAGE }),
      preHandler: manage,
      schema: {
        params: memberParams,
        summary: "Remove enterprise member",
        description:
          "Removes an exact enterprise-to-user affiliation under global sponsor administration (H43).",
      },
    },
    async (req) => {
      await removeEnterpriseMember(req.params.id, req.params.userId, req.userId);
      return { removed: true as const };
    },
  );

  // A user's enterprise affiliations — for the profile's Enterprise view.
  r.get(
    "/api/users/:id/enterprises",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.USERS_READ }),
      preHandler: requireCapability(CAPABILITIES.USERS_READ),
      schema: {
        params: z.object({ id: z.coerce.number().int().positive() }),
        summary: "List a user's enterprises",
        description:
          "Lists sponsor enterprise affiliations for an account with global user-read access (H43).",
      },
    },
    async (req) => ({ enterprises: await listUserEnterprises(req.params.id) }),
  );

  // Logo upload (H44 object storage) — the client POSTs the file as multipart;
  // the API stores it (so the browser never needs to reach the object store,
  // which is private behind the app network) and sets logo_url to the public
  // URL. NOTE: for the logo to *display*, S3_PUBLIC_URL must be a
  // browser-reachable host serving the bucket.
  r.post(
    "/api/enterprises/:id/logo",
    {
      ...access({ kind: "contextual", policy: "enterprise-access", resource: enterpriseParam }),
      preHandler: requireEnterpriseAccess(enterpriseParam),
      schema: {
        params: enterpriseIdParam,
        querystring: z.object({ variant: z.enum(["default", "negative"]).default("default") }),
        summary: "Upload enterprise logo",
        description:
          "Stores a logo for the caller's exact sponsor enterprise or for a global administrator (H44).",
      },
    },
    async (req) => {
      const file = await req.file();
      if (!file) throw new BadRequestError("No file uploaded");
      const ext = CONTENT_TYPE_EXT[file.mimetype as keyof typeof CONTENT_TYPE_EXT];
      if (!ext) {
        throw new BadRequestError(
          `Unsupported image type ${file.mimetype}. Allowed: ${Object.keys(CONTENT_TYPE_EXT).join(", ")}`,
        );
      }
      const bytes = await file.toBuffer();
      const key = `enterprises/${req.params.id}/logo-${req.query.variant}-${Date.now()}.${ext}`;
      const logoUrl = await putObject(key, bytes, file.mimetype);
      await setEnterpriseLogo(req.params.id, logoUrl, req.query.variant, req.userId);
      return { logoUrl, variant: req.query.variant };
    },
  );
}
