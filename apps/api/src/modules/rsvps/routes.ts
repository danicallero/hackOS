import { CAPABILITIES } from "@hackos/shared/capabilities";
import { ATTENDANCE_KINDS } from "@hackos/shared/onboarding";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { requireAuth, requireCapability } from "../../lib/capabilities.js";
import { assertFixtureSubjectScope } from "../../lib/fixture-subject-scope.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { routeAccessConfig as routeAccess } from "../../lib/route-policy.js";
import { getRsvps, submitRsvps, toRsvpItem } from "./service.js";
import { getRsvpSettings, putRsvpSettings } from "./settings.js";
import { rsvpSummaries } from "./summary.js";

const i18nSchema = z.record(z.string(), z.string().max(2000));

export const rsvpItemSchema = z.object({
  activityId: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  date: z.string(),
  closesAt: z.string(),
  location: z.string().nullable(),
  required: z.boolean(),
  answer: z.enum(["yes", "no", "unsure"]).nullable(),
  allowsUnsure: z.boolean(),
  locked: z.boolean(),
  isMeal: z.boolean(),
});
const itemsResponse = z.object({ items: z.array(rsvpItemSchema) });

export const rsvpAnswersBody = z
  .object({
    answers: z
      .array(
        z
          .object({
            activityId: z.number().int().positive(),
            answer: z.enum(["yes", "no", "unsure"]),
          })
          .strict(),
      )
      .max(200)
      .refine((a) => new Set(a.map((x) => x.activityId)).size === a.length, {
        message: "Each activity may appear only once",
      }),
  })
  .strict();

const kindCounts = z.object({
  attending: z.number(),
  notAttending: z.number(),
  unsure: z.number(),
  unanswered: z.number(),
});
export const rsvpSummarySchema = kindCounts.extend({
  activityId: z.number(),
  name: z.string(),
  nameI18n: z.record(z.string(), z.string()),
  startsAt: z.string(),
  isMeal: z.boolean(),
  required: z.boolean(),
  eligible: z.number(),
  byKind: z.partialRecord(z.enum(ATTENDANCE_KINDS), kindCounts),
  intolerances: z.array(
    z.object({ id: z.number(), label: z.record(z.string(), z.string()), n: z.number() }),
  ),
  withNotes: z.number(),
});

const settingsBody = z
  .object({
    enabled: z.boolean(),
    required: z.boolean(),
    kinds: z.array(z.enum(ATTENDANCE_KINDS)).max(4),
    nameI18n: i18nSchema.nullable(),
    descriptionI18n: i18nSchema.nullable(),
    rsvpDate: z.string().datetime({ offset: true }).nullable(),
    closesAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

const settingsResponse = settingsBody.omit({ rsvpDate: true, closesAt: true }).extend({
  activityId: z.number(),
  scheduleId: z.number(),
  isMeal: z.boolean(),
  rsvpDate: z.string().nullable(),
  closesAt: z.string().nullable(),
  defaults: z.object({
    name: z.string(),
    description: z.string().nullable(),
    date: z.string(),
    closesAt: z.string(),
  }),
  counts: rsvpSummarySchema.nullable(),
});

export function registerRsvpRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const idParam = z.object({ id: z.coerce.number().int().positive() });

  api.get(
    "/api/schedule/:id/rsvp",
    {
      preHandler: requireCapability(CAPABILITIES.SCHEDULE_MANAGE),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.SCHEDULE_MANAGE }),
      schema: {
        params: idParam,
        summary: "Get a schedule entry's RSVP settings",
        description:
          "Organizer view of the RSVP configuration of the entry's activity for the current event key: " +
          "whether it is enabled/required, which attendance kinds are asked, optional name/description/date overrides " +
          "and the effective defaults for blank fields. Includes live counts " +
          "(attending, notAttending, unsure, unanswered and by kind) under the same eligibility rule as " +
          "`GET /api/logistics/rsvps`. Requires schedule:manage.",
        response: { 200: settingsResponse },
      },
    },
    async (req) => getRsvpSettings(req.userId as number, req.params.id),
  );

  api.put(
    "/api/schedule/:id/rsvp",
    {
      preHandler: [requireCapability(CAPABILITIES.SCHEDULE_MANAGE), idempotencyGuard],
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.SCHEDULE_MANAGE }),
      schema: {
        params: idParam,
        body: settingsBody,
        summary: "Replace a schedule entry's RSVP settings",
        description:
          "Replaces the RSVP configuration for the current event key, audited in the same transaction. " +
          "`required` needs `enabled` and an enabled RSVP needs at least one kind. Meal activities can never ask " +
          "participants (400 `rsvp_participants_excluded`). Stored answers are never changed, and narrowing `kinds` only " +
          "stops asking and counting the excluded kinds. Accepts `Idempotency-Key`. Broadcasts `logistics.rsvp.updated`. Requires schedule:manage.",
        response: { 200: settingsResponse },
      },
    },
    async (req) =>
      putRsvpSettings(req.userId as number, req.params.id, {
        ...req.body,
        kinds: req.body.kinds,
      }),
  );

  api.get(
    "/api/me/rsvps",
    {
      preHandler: requireAuth,
      config: routeAccess({ kind: "authenticated" }),
      schema: {
        summary: "Get my RSVPs",
        description:
          "Open RSVPs offered to the caller: enabled for the current event key, on a shown schedule entry that has not ended, " +
          "and asked of the caller's attendance kind. Meals are never offered to registered participants and nothing is " +
          "offered to someone without an attendance classification. `answer` is null until answered; `unsure` is a stored " +
          "answer distinct from `no`. `locked` items (past `closesAt`) cannot change.",
        response: { 200: itemsResponse },
      },
    },
    async (req) => ({ items: await getRsvps(pool, req.userId as number) }),
  );

  api.put(
    "/api/me/rsvps",
    {
      preHandler: [requireAuth, idempotencyGuard],
      config: routeAccess({ kind: "authenticated", emailVerification: "none" }),
      schema: {
        body: rsvpAnswersBody,
        summary: "Answer my RSVPs",
        description:
          "Stores the given answers (yes, no or unsure). Required open items must be answered, either already stored or in the body " +
          "(400 `rsvp_incomplete`); optional ones may be left out. Changing a locked item is 409 `rsvp_locked`; echoing it " +
          "unchanged is ignored. A meal answer from a participant is 403 `rsvp_participants_excluded` regardless of settings; " +
          "an item not offered to the caller is 400 `rsvp_not_offered`; items that ended since the list loaded are ignored. " +
          "Concurrent submissions are serialized per user. Accepts `Idempotency-Key`. Broadcasts `logistics.rsvp.updated` " +
          "with the ids whose answer changed. Returns the same shape as GET.",
        response: { 200: itemsResponse },
      },
    },
    async (req) => {
      const { items } = await submitRsvps(req.userId as number, req.body.answers);
      return { items: items.map(toRsvpItem) };
    },
  );

  api.get(
    "/api/users/:id/rsvps",
    {
      preHandler: requireCapability(CAPABILITIES.MEAL_PLANS_MANAGE),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.MEAL_PLANS_MANAGE }),
      schema: {
        params: idParam,
        summary: "Get a user's RSVPs",
        description:
          "Staff view of the RSVPs offered to a user, same shape and eligibility as GET /api/me/rsvps. Requires meal-plans:manage.",
        response: { 200: itemsResponse },
      },
    },
    async (req) => {
      await assertFixtureSubjectScope(pool, req.userId as number, req.params.id);
      return { items: await getRsvps(pool, req.params.id) };
    },
  );

  api.put(
    "/api/users/:id/rsvps",
    {
      preHandler: [requireCapability(CAPABILITIES.MEAL_PLANS_MANAGE), idempotencyGuard],
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.MEAL_PLANS_MANAGE }),
      schema: {
        params: idParam,
        body: rsvpAnswersBody,
        summary: "Correct a user's RSVPs",
        description:
          "Staff correction. Same body, rules and errors as PUT /api/me/rsvps (locked items stay closed, participants never " +
          "get meals), except that it is partial: required items left out are not enforced. Writes one `rsvp.updated` audit " +
          "row with the attending activity ids before and after, in the same transaction. Accepts `Idempotency-Key`. " +
          "Requires meal-plans:manage.",
        response: { 200: itemsResponse },
      },
    },
    async (req) => {
      await assertFixtureSubjectScope(pool, req.userId as number, req.params.id);
      const { items } = await submitRsvps(req.params.id, req.body.answers, {
        actorId: req.userId as number,
      });
      return { items: items.map(toRsvpItem) };
    },
  );

  api.get(
    "/api/logistics/rsvps",
    {
      preHandler: requireCapability(CAPABILITIES.LOGISTICS_STATS),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.LOGISTICS_STATS }),
      schema: {
        querystring: z.object({ activityId: z.coerce.number().int().positive().optional() }),
        summary: "RSVP headcounts",
        description:
          "Per activity with enabled RSVP settings on a shown schedule entry (ended included): attending, notAttending, " +
          "unsure and unanswered among eligible people (current attendance kind in the asked kinds, never participants for " +
          "meals), broken down by kind, with the intolerance breakdown and dietary-note count among those attending. " +
          "Aggregates only; excludes inactive and anonymized accounts and honours the review-fixture boundary. " +
          "`activityId` narrows to one activity. Requires logistics statistics access.",
        response: { 200: z.object({ activities: z.array(rsvpSummarySchema) }) },
      },
    },
    async (req) => ({
      activities: await rsvpSummaries(req.userId as number, { activityId: req.query.activityId }),
    }),
  );
}
