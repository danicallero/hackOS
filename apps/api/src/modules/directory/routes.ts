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
import {
  directoryQuery,
  moderationBody,
  moderationParams,
  publicProfileBody,
  userParams,
} from "./schemas.js";
import {
  getDirectoryCv,
  getDirectoryEntry,
  getMyCv,
  getMyPublicProfile,
  listDirectory,
  moderatePublicProfile,
  removeMyCv,
  setMyCv,
  updateMyPublicProfile,
} from "./service.js";

const PDF_CACHE = "private, no-store";

const authenticated = { routeAccessPolicy: { kind: "authenticated" as const } };
const directoryReader = {
  routeAccessPolicy: { kind: "capability" as const, capability: CAPABILITIES.DIRECTORY_READ },
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
          "Directory opt-in settings shown on My profile for an event attendee, including bio, social links, `shareCv` and the uploaded CV's file name, with `preview`: the directory entry exactly as readers would see it if visible (its `cvUrl` points at the owner's own CV route). Without a saved profile the defaults apply (hidden, surname initial, no photo, project shown, no CV shared) (#934, #935).",
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
          "Replaces the caller's directory settings. Text is trimmed and empty text clears the field; headline ≤80, locationNote ≤60 and bio ≤500 characters, no control characters (the bio keeps line breaks). `socials` is up to 6 distinct {kind, url} links (kind: linkedin, github, x, instagram, website, other); URLs must be https (a bare host gets https://) and are stored normalized. `shareCv` needs an uploaded CV (400 otherwise). `bio`, `socials` and `shareCv` may be omitted to keep their stored values. consentedAt is stamped on each hidden→visible transition. Audited with the changed field names only, never text or links; repeating the stored settings writes nothing and wakes no client; 403 without event access. Accounts being removed (H54) are refused (#934, #935).",
      },
    },
    async (req) => {
      const { changed, profile } = await updateMyPublicProfile(req.userId as number, req.body);
      req.domainUnchanged = !changed;
      return profile;
    },
  );
  r.get(
    "/api/directory",
    {
      config: directoryReader,
      preHandler: requireCapability(CAPABILITIES.DIRECTORY_READ),
      schema: {
        querystring: directoryQuery,
        summary: "Browse the people directory",
        description:
          "Opted-in event attendees only, ordered by display name. `q` matches the display name ignoring accents and case; `challengeId` keeps people whose shown project takes part in that challenge. Page with the opaque `nextCursor`. Test, anonymized and removal-pending accounts are never listed; the reader must also have event access (#934).",
      },
    },
    async (req) => listDirectory(req.userId as number, req.query),
  );
  r.get(
    "/api/directory/:userId",
    {
      config: directoryReader,
      preHandler: requireCapability(CAPABILITIES.DIRECTORY_READ),
      schema: {
        params: userParams,
        summary: "Read one directory entry",
        description:
          "Returns one opted-in person: name, photo route (when shown), headline, bio, location note, social links, CV route (when shared), project and challenges. A missing and a hidden profile both answer 404, so visibility cannot be probed (#934, #935).",
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
          "Moderation: removes the person from the directory, clears their headline, location note, bio and social links and stops sharing their CV, with an audited reason. The person may opt in again (#934, #935).",
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
          "Multipart upload of the caller's CV for the public profile: one PDF (checked from its bytes) up to 5 MB, stored privately under the caller's profile prefix and never at a public URL. Replaces and deletes any previous CV. Readers see it only while the profile is visible and `shareCv` is on. Returns the public profile; audited as a `cv` change without the file name. 403 without event access; accounts being removed (H54) are refused (#935).",
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
          "Deletes the caller's CV object and turns `shareCv` off. Returns the public profile; removing when there is no CV changes nothing (#935).",
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
          "Streams the caller's own CV, shared or not. 404 without one. Never cached by shared proxies (#935).",
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
      config: directoryReader,
      preHandler: requireCapability(CAPABILITIES.DIRECTORY_READ),
      schema: {
        params: userParams,
        summary: "Download a shared CV",
        description:
          "Streams the CV of an opted-in person who shares it. A hidden profile, an unshared CV and a missing CV all answer 404. The access check runs on every request; the reader must also have event access (#935).",
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
