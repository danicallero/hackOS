import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EDITION_KEY_PATTERN } from "@hackos/shared/editions";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAuth, requireCapability } from "../../lib/capabilities.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { routeAccessOption as access } from "../../lib/route-policy.js";
import {
  activateEdition,
  closeEdition,
  createEdition,
  listEditions,
  myEditions,
  reopenEdition,
  updateEdition,
} from "./service.js";

const eventKeyParams = z.object({ eventKey: z.string().regex(EDITION_KEY_PATTERN) });
const timestamp = z.iso.datetime({ offset: true }).nullable();
const name = z.string().trim().min(1).max(120);

const createBody = z
  .object({
    eventKey: z.string().regex(EDITION_KEY_PATTERN),
    name,
    startsAt: timestamp.optional(),
    endsAt: timestamp.optional(),
  })
  .strict();

const patchBody = z
  .object({ name: name.optional(), startsAt: timestamp.optional(), endsAt: timestamp.optional() })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" });

const manage = { kind: "capability", capability: CAPABILITIES.EVENT_MANAGE } as const;
// Lifecycle actions change the edition catalogue itself, not one edition's data:
// reopening must work while the edition is closed (docs/multi-edition-plan.md).
const manageLifecycle = { ...manage, edition: "global" } as const;

export function registerEditionRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/me/editions",
    {
      ...access({ kind: "authenticated" }),
      preHandler: requireAuth,
      schema: {
        summary: "List my editions",
        description:
          "Editions the caller can view, newest first: the current edition (always; without a role there the caller is an applicant), every published edition they took part in (a role, an application or enterprise membership) and, for the global superadmin, every edition including drafts. `current` is the edition clients reset to on sign-in and app open. Send one of these keys as `X-Edition` to view it; a closed edition is read-only. Clients show an edition selector only when more than one is listed.",
      },
    },
    async (req) => myEditions(req.userId as number),
  );

  r.get(
    "/api/editions",
    {
      ...access(manage),
      preHandler: requireCapability(CAPABILITIES.EVENT_MANAGE),
      schema: {
        summary: "List editions",
        description:
          "Every edition with its status (draft, active, closed) and whether it is the current one, newest first. Requires event:manage.",
      },
    },
    async () => ({ items: await listEditions() }),
  );

  r.post(
    "/api/editions",
    {
      ...access(manageLifecycle),
      preHandler: [requireCapability(CAPABILITIES.EVENT_MANAGE), idempotencyGuard],
      schema: {
        body: createBody,
        summary: "Create an edition",
        description:
          "Creates a draft edition. Its key follows the event-key format and is never renamed. Nothing is copied from other editions: enterprises, stands, challenges and every person's participation start empty, and people apply again. 409 when the key exists. Audited (H53). Requires event:manage and Idempotency-Key.",
      },
    },
    async (req, reply) => {
      reply.code(201);
      return createEdition(req.userId as number, req.body);
    },
  );

  r.patch(
    "/api/editions/:eventKey",
    {
      ...access(manage),
      preHandler: [requireCapability(CAPABILITIES.EVENT_MANAGE), idempotencyGuard],
      schema: {
        params: eventKeyParams,
        body: patchBody,
        summary: "Rename or re-date an edition",
        description:
          "Changes an edition's name or dates. For the current edition this edits the event settings' name and event window. A closed edition answers edition_closed (409). Audited (H53). Requires event:manage.",
      },
    },
    async (req) => updateEdition(req.userId as number, req.params.eventKey, req.body),
  );

  r.post(
    "/api/editions/:eventKey/activate",
    {
      ...access(manageLifecycle),
      preHandler: [requireCapability(CAPABILITIES.EVENT_MANAGE), idempotencyGuard],
      schema: {
        params: eventKeyParams,
        summary: "Make an edition the current one",
        description:
          "Makes a draft or active edition the current edition (the default for every request without X-Edition). The previous edition's settings are kept as a snapshot; the new one starts with empty event windows, project phases and onboarding, and the previous edition's pending pre-event email is cancelled. A closed edition must be reopened first (409). Idempotent. Audited (H53). Requires event:manage.",
      },
    },
    async (req) => activateEdition(req.userId as number, req.params.eventKey),
  );

  r.post(
    "/api/editions/:eventKey/close",
    {
      ...access(manageLifecycle),
      preHandler: [requireCapability(CAPABILITIES.EVENT_MANAGE), idempotencyGuard],
      schema: {
        params: eventKeyParams,
        summary: "Close an edition",
        description:
          "Makes the edition read-only for everyone who had a role in it (only a reopen or the global superadmin can write afterwards). In one transaction: project drafts become not submitted, pending queue entries are cancelled and stay not evaluated, judging sessions end and rooms pause, open and claimed help requests are cancelled, and help windows and helper availability end. Nobody is notified. Certificates and public projects stay available. Closing a closed edition changes nothing. Returns the edition and the counts of each effect (null when nothing changed). Audited (H53). Requires event:manage.",
      },
    },
    async (req) => closeEdition(req.userId as number, req.params.eventKey),
  );

  r.post(
    "/api/editions/:eventKey/reopen",
    {
      ...access(manageLifecycle),
      preHandler: [requireCapability(CAPABILITIES.EVENT_MANAGE), idempotencyGuard],
      schema: {
        params: eventKeyParams,
        summary: "Reopen a closed edition",
        description:
          "Restores the ability to edit a closed edition. Nothing else is undone: cancelled requests and queue entries, not-submitted projects and sent or skipped notifications stay as they were. Reopening an edition that is not closed changes nothing. Audited (H53). Requires event:manage.",
      },
    },
    async (req) => reopenEdition(req.userId as number, req.params.eventKey),
  );
}
