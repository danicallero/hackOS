import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  getRequestAuthorizationContext,
  requireAuth,
  requireCapability,
  userHasCapability,
} from "../../lib/capabilities.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { keyByUser, rateLimitGuard } from "../../lib/rate-limit.js";
import { routeAccessOption as access } from "../../lib/route-policy.js";
import { entryParams, savePersonBody, scanBody, updateEntryBody } from "./schemas.js";
import {
  type DiaryReader,
  listDiary,
  removeEntry,
  savePerson,
  saveScanned,
  updateEntry,
} from "./service.js";

/**
 * #935: scan lookups are capped per account so badge UIDs cannot be
 * enumerated; a busy attendee scans a few people a minute.
 */
export const DIARY_SCAN_RATE_LIMIT = { windowSeconds: 60, max: 20 };

async function readerOf(req: FastifyRequest): Promise<DiaryReader> {
  return {
    userId: req.userId as number,
    canReadPeople: await userHasCapability(
      getRequestAuthorizationContext(req),
      CAPABILITIES.DIRECTORY_READ,
    ),
  };
}

export function registerDiaryRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/me/diary",
    {
      ...access({ kind: "authenticated" }),
      preHandler: requireAuth,
      schema: {
        summary: "Read my event diary",
        description:
          "The caller's saved people and sponsor stands, favourites first, then newest. Each entry carries the person's current directory card or the sponsor's current public card (name, logo, description, website, published challenges); either is null while the profile is hidden, the sponsor is not revealed, or (for people) the caller lacks `directory:read`. Private to the caller; requires event access (#935).",
      },
    },
    async (req) => listDiary(await readerOf(req)),
  );

  r.post(
    "/api/me/diary/scan",
    {
      ...access({ kind: "authenticated" }),
      preHandler: [
        requireAuth,
        rateLimitGuard("diary-scan", DIARY_SCAN_RATE_LIMIT, keyByUser),
        idempotencyGuard,
      ],
      schema: {
        body: scanBody,
        summary: "Save a scanned person or stand",
        description:
          "Resolves `code` — a sponsor stand NFC UID or `STAND-…` QR token, a badge NFC UID or badge QR, or a ticket QR — and saves it to the caller's diary. 201 for a new entry; a re-scan returns the existing entry with 200. Errors store nothing and name no one: `diary_code_unknown` (404), `badge_revoked` (409), `profile_not_shared` (409, the person's directory profile is hidden), `stand_unavailable` (409, sponsor not revealed), `diary_self` (409). Saving people needs `directory:read`. 20 scans per minute per account (429). The scanned person is not notified (#935).",
      },
    },
    async (req, reply) => {
      const { created, entry } = await saveScanned(await readerOf(req), req.body.code);
      reply.code(created ? 201 : 200);
      return entry;
    },
  );

  r.post(
    "/api/me/diary/people",
    {
      ...access({ kind: "capability", capability: CAPABILITIES.DIRECTORY_READ }),
      preHandler: [requireCapability(CAPABILITIES.DIRECTORY_READ), idempotencyGuard],
      schema: {
        body: savePersonBody,
        summary: "Save a person from the directory",
        description:
          "Adds a currently visible directory person to the caller's diary. 201 for a new entry, 200 with the existing one when already saved. A hidden or missing profile answers 404, as in the directory (#935).",
      },
    },
    async (req, reply) => {
      const { created, entry } = await savePerson(await readerOf(req), req.body.userId);
      reply.code(created ? 201 : 200);
      return entry;
    },
  );

  r.patch(
    "/api/me/diary/:entryId",
    {
      ...access({ kind: "authenticated" }),
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        params: entryParams,
        body: updateEntryBody,
        summary: "Update a diary entry",
        description:
          "Sets `starred` and/or the private `note` (≤500 characters, trimmed; empty clears it). Only the owner's entries; others answer 404 (#935).",
      },
    },
    async (req) => updateEntry(await readerOf(req), req.params.entryId, req.body),
  );

  r.delete(
    "/api/me/diary/:entryId",
    {
      ...access({ kind: "authenticated" }),
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        params: entryParams,
        summary: "Remove a diary entry",
        description:
          "Deletes one of the caller's diary entries; others answer 404. Scanning the same person or stand again saves it anew (#935).",
      },
    },
    async (req, reply) => {
      await removeEntry(await readerOf(req), req.params.entryId);
      return reply.code(204).send();
    },
  );
}
