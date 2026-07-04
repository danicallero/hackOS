import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireCapability } from "../../lib/capabilities.js";
import { ForbiddenError, UnauthorizedError } from "../../lib/errors.js";
import { presignUpload } from "../../lib/storage.js";
import { assertCanEditEnterprise } from "./access.js";
import {
  CONTENT_TYPE_EXT,
  createEnterpriseBody,
  enterpriseIdParam,
  logoUploadBody,
  OWNER_EDITABLE_KEYS,
  updateEnterpriseBody,
} from "./schemas.js";
import {
  createEnterprise,
  getEnterprise,
  listEnterprises,
  listPublicSponsors,
  myEnterprise,
  setEnterpriseLogo,
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

  // Sponsor rep's own enterprise (H44).
  r.get(
    "/api/enterprises/mine",
    { preHandler: requireCapability(CAPABILITIES.SPONSOR_PORTAL) },
    async (req) => myEnterprise(actor(req.userId)),
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

  // Presign a logo upload (H44 object storage). The client PUTs the bytes to
  // `uploadUrl`; logo_url is set optimistically to the resulting public URL.
  r.post(
    "/api/enterprises/:id/logo",
    { schema: { params: enterpriseIdParam, body: logoUploadBody } },
    async (req) => {
      await assertCanEditEnterprise(req.userId, req.params.id);
      const ext = CONTENT_TYPE_EXT[req.body.contentType];
      const key = `enterprises/${req.params.id}/logo-${Date.now()}.${ext}`;
      const presigned = await presignUpload(key, req.body.contentType);
      await setEnterpriseLogo(req.params.id, presigned.publicUrl, req.userId);
      return presigned;
    },
  );
}
