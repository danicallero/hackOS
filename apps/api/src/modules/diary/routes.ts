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
          "Resolves a current badge, ticket, company NFC tag, QR token or tag link and saves every currently available destination in one transaction. A UID may be both a person's badge and a company's tag: returns the person as the primary diary entry and the saved company in optional `relatedEntries`. Without an explicit tag link, a representative's badge never grants their company. 201 if either entry is new, otherwise 200; retries preserve notes and favourites. Person resolution uses the latest server assignment and rechecks it after locking, never the old holder in badge history. A hidden/revoked/self person does not prevent collecting an available company, nor does an unavailable company prevent saving a shared person. If nothing can be saved: diary_code_unknown (404), badge_revoked/profile_not_shared/stand_unavailable/diary_self (409); errors reveal no private identity. Requires event access, 20 scans/minute, Idempotency-Key. Person scans are reciprocal only when the scanner also shares a profile; company scans remain one-way. No diary notifications or staff-readable social audit (#935).",
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
