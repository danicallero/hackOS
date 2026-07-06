import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireAuth, requireCapability } from "../../lib/capabilities.js";
import { BadRequestError, ForbiddenError, UnauthorizedError } from "../../lib/errors.js";
import { putObject } from "../../lib/storage.js";
import { assertCanEditEnterprise } from "./access.js";
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
  r.get("/api/public/sponsors", async () => ({ items: await listPublicSponsors() }));

  r.get("/api/enterprises", { preHandler: manage }, async () => ({
    enterprises: await listEnterprises(),
  }));

  r.post(
    "/api/enterprises",
    { preHandler: manage, schema: { body: createEnterpriseBody } },
    async (req, reply) => {
      const created = await createEnterprise(req.body, req.userId);
      reply.code(201);
      return created;
    },
  );

  // Admin bulk visibility flip from the enterprises list (H45).
  r.post(
    "/api/enterprises/visibility",
    { preHandler: manage, schema: { body: bulkVisibilityBody } },
    async (req) => setEnterprisesVisibility(req.body.ids, req.body.visible, req.userId),
  );

  // Sponsor rep's own enterprise (H44).
  r.get("/api/enterprises/mine", { preHandler: requireAuth }, async (req) =>
    myEnterprise(actor(req.userId)),
  );

  r.get("/api/enterprises/:id", { schema: { params: enterpriseIdParam } }, async (req) => {
    await assertCanEditEnterprise(req.userId, req.params.id);
    return getEnterprise(req.params.id);
  });

  r.patch(
    "/api/enterprises/:id",
    { schema: { params: enterpriseIdParam, body: updateEnterpriseBody } },
    async (req) => {
      const access = await assertCanEditEnterprise(req.userId, req.params.id);
      if (access === "owner") {
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
    { preHandler: manage, schema: { params: enterpriseIdParam } },
    async (req) => ({ members: await listEnterpriseMembers(req.params.id) }),
  );

  r.post(
    "/api/enterprises/:id/members",
    { preHandler: manage, schema: { params: enterpriseIdParam, body: addMemberBody } },
    async (req, reply) => {
      const member = await addEnterpriseMember(req.params.id, req.body.userId, req.userId);
      reply.code(201);
      return member;
    },
  );

  r.delete(
    "/api/enterprises/:id/members/:userId",
    { preHandler: manage, schema: { params: memberParams } },
    async (req) => {
      await removeEnterpriseMember(req.params.id, req.params.userId, req.userId);
      return { removed: true as const };
    },
  );

  // A user's enterprise affiliations — for the profile's Enterprise view.
  r.get(
    "/api/users/:id/enterprises",
    {
      preHandler: requireCapability(CAPABILITIES.USERS_READ),
      schema: { params: enterpriseIdParam },
    },
    async (req) => ({ enterprises: await listUserEnterprises(req.params.id) }),
  );

  // Logo upload (H44 object storage) — the client POSTs the file as multipart;
  // the API stores it (so the browser never needs to reach the object store,
  // which is private behind the app network) and sets logo_url to the public
  // URL. NOTE: for the logo to *display*, S3_PUBLIC_URL must be a
  // browser-reachable host serving the bucket.
  r.post("/api/enterprises/:id/logo", { schema: { params: enterpriseIdParam } }, async (req) => {
    await assertCanEditEnterprise(req.userId, req.params.id);
    const file = await req.file();
    if (!file) throw new BadRequestError("No file uploaded");
    const ext = CONTENT_TYPE_EXT[file.mimetype as keyof typeof CONTENT_TYPE_EXT];
    if (!ext) {
      throw new BadRequestError(
        `Unsupported image type ${file.mimetype}. Allowed: ${Object.keys(CONTENT_TYPE_EXT).join(", ")}`,
      );
    }
    const bytes = await file.toBuffer();
    const key = `enterprises/${req.params.id}/logo-${Date.now()}.${ext}`;
    const logoUrl = await putObject(key, bytes, file.mimetype);
    await setEnterpriseLogo(req.params.id, logoUrl, req.userId);
    return { logoUrl };
  });
}
