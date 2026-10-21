import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { requireAnyCapability, requireAuth } from "../../lib/capabilities.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { routeAccessOption as routeAccess } from "../../lib/route-policy.js";
import { createReport, listReports, moderatedKinds, resolveReport } from "./service.js";

const reasons = ["inappropriate", "harassment", "spam", "other"] as const;

const createBody = z
  .object({
    projectId: z.number().int().positive().optional(),
    userId: z.number().int().positive().optional(),
    reason: z.enum(reasons),
    details: z.string().trim().max(500).nullish(),
  })
  .refine((body) => (body.projectId === undefined) !== (body.userId === undefined), {
    message: "Report exactly one project or one person",
  });

const listQuery = z.object({
  status: z.enum(["open", "actioned", "dismissed", "all"]).default("open"),
});
const idParams = z.object({ id: z.coerce.number().int().positive() });
const resolveBody = z.object({
  status: z.enum(["actioned", "dismissed"]),
  note: z.string().trim().max(500).nullish(),
});

const person = z.object({
  id: z.number(),
  name: z.string().nullable(),
  surname: z.string().nullable(),
});
const reportSchema = z.object({
  id: z.number(),
  kind: z.enum(["project", "profile"]),
  reason: z.enum(reasons),
  details: z.string().nullable(),
  status: z.enum(["open", "actioned", "dismissed"]),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
  reporter: person,
  project: z.object({ id: z.number(), name: z.string() }).nullable(),
  person: person.nullable(),
});

/** H18: attendee reports of user-generated content and the organiser inbox that reads them. */
export function registerReportRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const moderate = requireAnyCapability(CAPABILITIES.USERS_WRITE, CAPABILITIES.PROJECTS_EDIT);
  const policy = {
    kind: "capability" as const,
    anyOf: [CAPABILITIES.USERS_WRITE, CAPABILITIES.PROJECTS_EDIT],
  };

  r.post(
    "/api/reports",
    {
      config: { routeAccessPolicy: { kind: "authenticated" as const } },
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        body: createBody,
        summary: "Report a project or a person's profile",
        description:
          "An event attendee reports a project page they can view (never their own) or the public profile of a person they saved in their diary (never their own), with a reason (inappropriate, harassment, spam, other) and up to 500 characters of detail. Targets the caller cannot see answer 404, so a report cannot probe for hidden content. Reporting the same target again returns the open report; at most 10 reports can be open at once (429). Organisers read it in the report inbox (H18).",
        response: { 200: z.object({ id: z.number(), status: z.literal("open") }) },
      },
    },
    async (req) => createReport(req.userId as number, req.body),
  );

  r.get(
    "/api/content-reports",
    {
      ...routeAccess(policy),
      preHandler: moderate,
      schema: {
        querystring: listQuery,
        summary: "List reported content",
        description:
          "The organiser report inbox, open reports first and then newest, at most 200. Reports about projects need `projects:edit`, reports about profiles need `users:write`; a moderator sees only the kinds they hold. Reports by synthetic review accounts are visible only to synthetic moderators. The reported content itself is read live from its own page, never copied here (H18).",
        response: { 200: z.object({ items: z.array(reportSchema) }) },
      },
    },
    async (req) => {
      const userId = req.userId as number;
      return { items: await listReports(userId, await moderatedKinds(userId), req.query.status) };
    },
  );

  r.patch(
    "/api/content-reports/:id",
    {
      ...routeAccess(policy),
      preHandler: [moderate, idempotencyGuard],
      schema: {
        params: idParams,
        body: resolveBody,
        summary: "Close a report",
        description:
          "Marks an open report `actioned` (the content was edited or hidden through its own moderation tool) or `dismissed`, with an optional note. Audited as `content_report.actioned` or `content_report.dismissed`. 404 for a report outside the caller's kinds or synthetic scope, 409 when it is already closed (H18, H53).",
        response: { 200: z.object({ id: z.number(), status: z.enum(["actioned", "dismissed"]) }) },
      },
    },
    async (req) => {
      const userId = req.userId as number;
      await resolveReport(
        userId,
        await moderatedKinds(userId),
        req.params.id,
        req.body.status,
        req.body.note ?? null,
      );
      return { id: req.params.id, status: req.body.status };
    },
  );
}
