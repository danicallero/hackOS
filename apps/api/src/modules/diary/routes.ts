import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireAuth } from "../../lib/capabilities.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { keyByUser, rateLimitGuard } from "../../lib/rate-limit.js";
import { routeAccessOption as access } from "../../lib/route-policy.js";
import { entryParams, scanBody, updateEntryBody } from "./schemas.js";
import {
  listDiary,
  listSponsorCollection,
  removeEntry,
  saveScanned,
  updateEntry,
} from "./service.js";

/**
 * #935: scan lookups are capped per account so badge UIDs cannot be
 * enumerated; a busy attendee scans a few people a minute.
 */
export const DIARY_SCAN_RATE_LIMIT = { windowSeconds: 60, max: 20 };

function ownerOf(req: FastifyRequest): number {
  return req.userId as number;
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
          "The caller's saved people and sponsor stands, favourites first, then newest. Each entry carries the person's current public profile card or the sponsor's current public card (name, logo, description, website, published challenges); either is null while the profile is hidden or the sponsor is not revealed. Private to the caller; requires event access (#935).",
      },
    },
    async (req) => listDiary(ownerOf(req)),
  );

  r.get(
    "/api/me/diary/sponsors",
    {
      ...access({ kind: "authenticated" }),
      preHandler: requireAuth,
      schema: {
        summary: "Read my sponsor stand collection",
        description:
          "The sponsor stands the caller can collect by scanning them: every revealed sponsor staff marked scannable (listed even before its tags exist), plus revealed sponsors the caller already collected even if their tags were removed since. Hidden sponsors are never listed or counted. Returns `total`, `collected` and `items`: the public sponsor card with `entry` (the caller's diary entry id, favourite, note and collection time) or null while not yet collected; ordered like the public logo grid: sponsor priority (1 first, unset last), then name, whether collected or not. Stand tag codes are never exposed. Private to the caller; requires event access (#935).",
      },
    },
    async (req) => listSponsorCollection(ownerOf(req)),
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
          "Resolves `code` — a company tag (NFC tag or wristband UID, `STAND-…` QR token, or its link `https://<web host>/s/<code>`), a badge NFC UID or badge QR, or a ticket QR — and saves it to the caller's diary. 201 for a new entry; a re-scan returns the existing entry with 200. Errors store nothing and name no one: `diary_code_unknown` (404), `badge_revoked` (409), `profile_not_shared` (409, the person does not share a public profile), `stand_unavailable` (409, sponsor not revealed), `diary_self` (409). Scanning is the only way to add a person; any attendee may save people; only shared public profiles are ever saved or shown. 20 scans per minute per account (429). The scanned person is not notified (#935).",
      },
    },
    async (req, reply) => {
      const { created, entry } = await saveScanned(ownerOf(req), req.body.code);
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
    async (req) => updateEntry(ownerOf(req), req.params.entryId, req.body),
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
      await removeEntry(ownerOf(req), req.params.entryId);
      return reply.code(204).send();
    },
  );
}
