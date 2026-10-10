import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireAuth, requireCapability } from "../../lib/capabilities.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import {
  directoryQuery,
  moderationBody,
  moderationParams,
  publicProfileBody,
  userParams,
} from "./schemas.js";
import {
  getDirectoryEntry,
  getMyPublicProfile,
  listDirectory,
  moderatePublicProfile,
  updateMyPublicProfile,
} from "./service.js";

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
          "Directory opt-in settings shown on My profile for an event attendee, with `preview`: the directory entry exactly as readers would see it if visible. Without a saved profile the defaults apply (hidden, surname initial, no photo, project shown) (#934).",
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
          "Replaces the caller's directory settings. Text is trimmed and empty text clears the field; headline ≤80 and locationNote ≤60 characters, no control characters. consentedAt is stamped on each hidden→visible transition. Audited without free text when something changes; repeating the stored settings writes nothing and wakes no client; 403 without event access. Accounts being removed (H54) are refused (#934).",
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
          "Returns one opted-in person. A missing and a hidden profile both answer 404, so visibility cannot be probed (#934).",
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
          "Moderation: removes the person from the directory and clears their headline and location note, with an audited reason. The person may opt in again (#934).",
      },
    },
    async (req, reply) => {
      await moderatePublicProfile(req.userId as number, req.params.id, req.body.reason);
      return reply.code(204).send();
    },
  );
}
