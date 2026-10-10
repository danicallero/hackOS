import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireAuth, requireCapability } from "../../lib/capabilities.js";
import { BadRequestError } from "../../lib/errors.js";
import { idempotencyGuard, requireIdempotencyKey } from "../../lib/idempotency.js";
import {
  CV_MAX_BYTES,
  deleteReplacedObject,
  isPdf,
  profilePrefix,
  readUpload,
  safePdfFilename,
  sendProfileObject,
  uploadOperation,
} from "../../lib/profile-files.js";
import { putObject } from "../../lib/storage.js";
import { moderationBody, moderationParams, publicProfileBody, userParams } from "./schemas.js";
import {
  getDirectoryCv,
  getDirectoryEntry,
  getMyCv,
  getMyPublicProfile,
  moderatePublicProfile,
  removeMyCv,
  setMyCv,
  updateMyPublicProfile,
} from "./service.js";

const PDF_CACHE = "private, no-store";

const authenticated = { routeAccessPolicy: { kind: "authenticated" as const } };
/** An attendee who saved this person in their diary by scanning them (#935). */
const personReader = {
  routeAccessPolicy: {
    kind: "contextual" as const,
    policy: "directory-person-access",
    resource: { source: "params" as const, field: "userId" },
  },
};

export function registerDirectoryRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get(
    "/api/me/public-profile",
    {
      config: authenticated,
      preHandler: requireAuth,
      schema: {
        summary: "Read my public profile",
        description:
          "Public profile opt-in settings shown on My profile for an event attendee, including bio, social links, `shareCv` and the CV (`cv.source`: `application` when it comes from the file field the organizer marked as the profile CV in the person's latest submitted application, which then wins over any upload; otherwise `upload`), with `preview`: the card exactly as people who scan the owner would see it if visible (its `cvUrl` points at the owner's own CV route). Without a saved profile the defaults apply (hidden, surname initial, no photo, project shown, no CV shared) (#934, #935).",
      },
    },
    async (req) => getMyPublicProfile(req.userId as number),
  );
  r.put(
    "/api/me/public-profile",
    {
      config: authenticated,
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        body: publicProfileBody,
        summary: "Update my public profile",
        description:
          "Replaces the caller's public profile settings. Text is trimmed and empty text clears the field; headline ≤80, locationNote ≤60 and bio ≤500 characters, no control characters (the bio keeps line breaks). `socials` is up to 6 distinct {kind, url} links (kind: linkedin, github, x, instagram, website, other); URLs must be https (a bare host gets https://) and are stored normalized. `shareCv` needs an uploaded or application CV (400 otherwise). `bio`, `socials` and `shareCv` may be omitted to keep their stored values. consentedAt is stamped on each hidden→visible transition. Audited with the changed field names only, never text or links; repeating the stored settings writes nothing and wakes no client; 403 without event access. Accounts being removed (H54) are refused (#934, #935).",
      },
    },
    async (req) => {
      const { changed, profile } = await updateMyPublicProfile(req.userId as number, req.body);
      req.domainUnchanged = !changed;
      return profile;
    },
  );
  r.get(
    "/api/directory/:userId",
    {
      config: personReader,
      preHandler: requireAuth,
      schema: {
        params: userParams,
        summary: "Read a saved person's public profile",
        description:
          "Returns one opted-in person: name, photo route (when shown), headline, bio, location note, social links, CV route (when shared), project and challenges. Only attendees who saved this person in their diary (by scanning their badge or ticket) may read it. A missing or hidden profile, and a person the caller has not saved, all answer 404, so visibility cannot be probed (#934, #935).",
      },
    },
    async (req) => getDirectoryEntry(req.userId as number, req.params.userId),
  );
  r.delete(
    "/api/users/:id/public-profile",
    {
      config: {
        routeAccessPolicy: { kind: "capability" as const, capability: CAPABILITIES.USERS_WRITE },
      },
      preHandler: [requireCapability(CAPABILITIES.USERS_WRITE), idempotencyGuard],
      schema: {
        params: moderationParams,
        body: moderationBody,
        summary: "Hide a public profile",
        description:
          "Moderation: hides the person's public profile, clears their headline, location note, bio and social links and stops sharing their CV, with an audited reason. The person may opt in again (#934, #935).",
      },
    },
    async (req, reply) => {
      await moderatePublicProfile(req.userId as number, req.params.id, req.body.reason);
      return reply.code(204).send();
    },
  );

  r.post(
    "/api/me/public-profile/cv",
    {
      config: authenticated,
      preHandler: [requireAuth, requireIdempotencyKey],
      schema: {
        summary: "Upload my CV",
        description:
          "Multipart upload of the caller's CV for the public profile: one PDF (checked from its bytes) up to 5 MB, stored privately under the caller's profile prefix and never at a public URL. Replaces and deletes any previous CV. Readers see it only while the profile is visible and `shareCv` is on. Returns the public profile; audited as a `cv` change without the file name. 409 while the CV comes from the caller's application; 403 without event access; accounts being removed (H54) are refused (#935).",
      },
    },
    async (req) => {
      const userId = req.userId as number;
      const { file, bytes } = await readUpload(req, CV_MAX_BYTES);
      if (!isPdf(bytes)) throw new BadRequestError("The CV must be a PDF");
      const key = `${profilePrefix(userId)}cv/${uploadOperation(req)}.pdf`;
      const { replacedKey, profile } = await setMyCv(
        userId,
        { key, filename: safePdfFilename(file.filename) },
        async () => {
          await putObject(key, bytes, "application/pdf");
        },
      );
      await deleteReplacedObject(req, replacedKey);
      return profile;
    },
  );
  r.delete(
    "/api/me/public-profile/cv",
    {
      config: authenticated,
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        summary: "Remove my CV",
        description:
          "Deletes the caller's CV object and turns `shareCv` off. Returns the public profile; removing when there is no CV changes nothing; 409 while the CV comes from the caller's application (#935).",
      },
    },
    async (req) => {
      const { changed, removedKey, profile } = await removeMyCv(req.userId as number);
      req.domainUnchanged = !changed;
      await deleteReplacedObject(req, removedKey);
      return profile;
    },
  );
  r.get(
    "/api/me/public-profile/cv",
    {
      config: authenticated,
      preHandler: requireAuth,
      schema: {
        summary: "Download my CV",
        description:
          "Streams the caller's own CV, shared or not: the application CV when there is one, otherwise the upload. 404 without either. Never cached by shared proxies (#935).",
      },
    },
    async (req, reply) => {
      const cv = await getMyCv(req.userId as number);
      return sendProfileObject(reply, cv.key, {
        contentType: "application/pdf",
        cacheControl: PDF_CACHE,
        filename: cv.filename,
      });
    },
  );
  r.get(
    "/api/directory/:userId/cv",
    {
      config: personReader,
      preHandler: requireAuth,
      schema: {
        params: userParams,
        summary: "Download a shared CV",
        description:
          "Streams the CV of an opted-in person who shares it: their application CV when there is one, otherwise their upload. A hidden profile, an unshared CV and a missing CV all answer 404. Only for attendees who saved this person; the access check runs on every request and the reader must also have event access (#935).",
      },
    },
    async (req, reply) => {
      const cv = await getDirectoryCv(req.userId as number, req.params.userId);
      return sendProfileObject(reply, cv.key, {
        contentType: "application/pdf",
        cacheControl: PDF_CACHE,
        filename: cv.filename,
      });
    },
  );
}
