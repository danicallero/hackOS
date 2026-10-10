import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool } from "../../db/pool.js";
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
import { assertFixtureSubjectScope } from "../logistics/review-fixture-scope.js";
import { moderationBody, moderationParams, publicProfileBody, userParams } from "./schemas.js";
import {
  getDirectoryCv,
  getDirectoryEntry,
  getMyCv,
  getMyPublicProfile,
  getStaffPublicProfile,
  moderatePublicProfile,
  removeCv,
  removeMyCv,
  setMyCv,
  updateMyPublicProfile,
  updatePublicProfile,
} from "./service.js";

const PDF_CACHE = "private, no-store";

const authenticated = { routeAccessPolicy: { kind: "authenticated" as const } };
const usersReader = {
  routeAccessPolicy: { kind: "capability" as const, capability: CAPABILITIES.USERS_READ },
};
const usersWriter = {
  routeAccessPolicy: { kind: "capability" as const, capability: CAPABILITIES.USERS_WRITE },
};

/**
 * User-management staff act on someone's public profile within the same
 * synthetic-account boundary as every user edit (H8); unknown accounts are 404.
 */
async function staffSubject(req: FastifyRequest<{ Params: { id: number } }>): Promise<number> {
  await assertFixtureSubjectScope(pool, req.userId as number, req.params.id);
  return req.params.id;
}

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
          "Public profile opt-in settings shown on My profile for an event attendee, including bio, social links, `shareCv` and the CV (`cv.source`: `application` when the person's latest submitted application has a PDF in the file question marked as the profile CV or, failing that, in a file question named CV/curriculum/resume, which then wins over any upload and is read-only here; otherwise `upload`), the switches `showSurname`, `showPhoto`, `showProject` and `shareCv` that decide what scanners receive (hidden data is omitted from the response, not just from the UI), with `preview`: the card exactly as people who scan the owner would see it if visible (its `cvUrl` points at the owner's own CV route). Without a saved profile the defaults apply (hidden, surname initial, no photo, project shown, no CV shared) (#934, #935).",
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
          "Replaces the caller's public profile settings. Text is trimmed and empty text clears the field; headline ≤80, locationNote ≤60 and bio ≤500 characters, no control characters (the bio keeps line breaks). `socials` is up to 6 distinct {kind, url} links (kind: linkedin, github, x, instagram, website, other); URLs must be https (a bare host gets https://) and are stored normalized. `shareCv` needs an uploaded or application CV (400 otherwise). `bio`, `socials`, and `shareCv` may be omitted to keep their stored values. consentedAt is stamped on each hidden→visible transition. Audited with the changed field names only, never text or links; repeating the stored settings writes nothing and wakes no client; 403 without event access. Accounts being removed (H54) are refused (#934, #935).",
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
          "Returns one opted-in person: name, photo route (when shown), headline, bio, location note, social links, CV route (when shared), project and challenges (when `showProject`). Only attendees who saved this person in their diary (by scanning their badge or ticket) may read it. A missing or hidden profile, and a person the caller has not saved, all answer 404, so visibility cannot be probed (#934, #935).",
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
      await moderatePublicProfile(req.userId as number, await staffSubject(req), req.body.reason);
      return reply.code(204).send();
    },
  );

  r.get(
    "/api/users/:id/public-profile",
    {
      config: usersReader,
      preHandler: requireCapability(CAPABILITIES.USERS_READ),
      schema: {
        params: moderationParams,
        summary: "Read a person's public profile",
        description:
          "User management: anyone's public profile settings, shared or not, in the same shape as GET /api/me/public-profile. `preview` is the card the people who scan them see while it is shared; its `cvUrl` points at the staff CV route. Not audited, like every user-management read. 404 for an unknown or out-of-scope account (#935, H8).",
      },
    },
    async (req) => getStaffPublicProfile(await staffSubject(req)),
  );
  r.put(
    "/api/users/:id/public-profile",
    {
      config: usersWriter,
      preHandler: [requireCapability(CAPABILITIES.USERS_WRITE), idempotencyGuard],
      schema: {
        params: moderationParams,
        body: publicProfileBody,
        summary: "Edit a person's public profile",
        description:
          "User-management moderation: replaces someone's public profile settings with the same body and validation as PUT /api/me/public-profile. Staff may stop sharing (`directoryVisible: false`) but never start it: turning sharing on for a hidden profile answers 409 `profile_consent_required`. Audited as `public_profile.updated` with source `admin` and the changed field names only; repeating the stored settings writes nothing. 404 for an unknown or out-of-scope account; accounts being removed (H54) answer 409 (#935, H8, H53).",
      },
    },
    async (req) => {
      const userId = await staffSubject(req);
      const { changed, profile } = await updatePublicProfile(userId, req.body, {
        actorId: req.userId as number,
        source: "admin",
      });
      req.domainUnchanged = !changed;
      return profile;
    },
  );
  r.get(
    "/api/users/:id/public-profile/cv",
    {
      config: usersReader,
      preHandler: requireCapability(CAPABILITIES.USERS_READ),
      schema: {
        params: moderationParams,
        summary: "Download a person's CV",
        description:
          "User management: streams someone's profile CV, shared or not, so staff can review it: the application CV when there is one, otherwise the upload. 404 without either, or for an unknown or out-of-scope account. Never cached by shared proxies (#935, H8).",
      },
    },
    async (req, reply) => {
      const cv = await getMyCv(await staffSubject(req));
      return sendProfileObject(reply, cv.key, {
        contentType: "application/pdf",
        cacheControl: PDF_CACHE,
        filename: cv.filename,
      });
    },
  );
  r.delete(
    "/api/users/:id/public-profile/cv",
    {
      config: usersWriter,
      preHandler: [requireCapability(CAPABILITIES.USERS_WRITE), idempotencyGuard],
      schema: {
        params: moderationParams,
        summary: "Remove a person's CV",
        description:
          "User-management moderation: deletes someone's uploaded profile CV and stops sharing it, audited as `public_profile.updated` with source `admin` and `changedFields: [\"cv\"]`. Removing when there is no CV changes nothing. A CV that comes from the person's application answers 409; staff stop sharing it with PUT instead. Returns the profile. 404 for an unknown or out-of-scope account (#935, H8, H53).",
      },
    },
    async (req) => {
      const userId = await staffSubject(req);
      const { changed, removedKey, profile } = await removeCv(userId, {
        actorId: req.userId as number,
        source: "admin",
      });
      req.domainUnchanged = !changed;
      await deleteReplacedObject(req, removedKey);
      return profile;
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
