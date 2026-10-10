import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../../db/pool.js";
import { requireAuth, requireCapability } from "../../../lib/capabilities.js";
import { idempotencyGuard } from "../../../lib/idempotency.js";
import { routeAccessConfig as routeAccess } from "../../../lib/route-policy.js";
import { assertFixtureSubjectScope } from "../../logistics/review-fixture-scope.js";
import { getMealPlan, replaceMealPlan } from "../meal-plan.js";

/**
 * Sponsor meal plan (#933). Self-service is a benign self-edit (no audit
 * row); the staff correction under meal-plans:manage is audited.
 */

export const mealPlanResponseSchema = z.object({
  confirmedAt: z.string().nullable(),
  cutoffHours: z.number().int(),
  meals: z.array(
    z.object({
      activityId: z.number(),
      name: z.string(),
      nameI18n: z.record(z.string(), z.string()).nullable(),
      startsAt: z.string(),
      endsAt: z.string(),
      location: z.string().nullable(),
      attending: z.boolean().nullable(),
      locked: z.boolean(),
    }),
  ),
});

export const mealPlanBodySchema = z
  .object({
    meals: z
      .array(z.object({ activityId: z.number().int().positive(), attending: z.boolean() }).strict())
      .max(200)
      .refine((meals) => new Set(meals.map((m) => m.activityId)).size === meals.length, {
        message: "Each meal may appear only once",
      }),
  })
  .strict();

export function registerMealPlanRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get(
    "/api/me/meal-plan",
    {
      preHandler: requireAuth,
      config: routeAccess({ kind: "authenticated" }),
      schema: {
        summary: "Get my meal plan",
        description:
          "Sponsor representatives only (403 `not_sponsor` otherwise). Lists the upcoming meals " +
          "offered to sponsors — meal-kind activities whose shown schedule entry includes the " +
          "`sponsor` audience (an entry with no audiences is staff-only and never offered) — with the caller's answer (`attending` is null until " +
          "answered) and whether the meal is `locked` because it starts within the event's change " +
          "cutoff (`cutoffHours`, 24 by default). `confirmedAt` is when the plan was first submitted.",
        response: { 200: mealPlanResponseSchema },
      },
    },
    async (req) => getMealPlan(pool, req.userId as number),
  );

  api.put(
    "/api/me/meal-plan",
    {
      preHandler: [requireAuth, idempotencyGuard],
      // Profile setup, like PATCH /api/me: reachable before email verification.
      config: routeAccess({ kind: "authenticated", emailVerification: "none" }),
      schema: {
        summary: "Replace my meal plan",
        description:
          "Sponsor representatives only (403 `not_sponsor`). The body must answer every offered, " +
          "unlocked meal (400 `meal_plan_incomplete`). Meals that ended or stopped being offered " +
          "since the list was loaded are ignored; an id that is not a meal activity at all is 400 " +
          "`meal_not_offered`. Changing a locked meal's stored answer is 409 `meal_plan_locked`; " +
          "echoing it unchanged, or sending any answer for a locked meal that was never answered, " +
          "is ignored. Concurrent submissions are serialized per user, so the stored plan always " +
          "matches one whole request. Accepts `Idempotency-Key`. Broadcasts " +
          "`logistics.meal_plan.updated` with the ids of meals whose answer actually changed, and " +
          "nothing when none did. Returns the same shape as GET.",
        body: mealPlanBodySchema,
        response: { 200: mealPlanResponseSchema },
      },
    },
    async (req) => replaceMealPlan(req.userId as number, req.body.meals),
  );

  const userParams = z.object({ id: z.coerce.number().int().positive() });

  api.get(
    "/api/users/:id/meal-plan",
    {
      preHandler: requireCapability(CAPABILITIES.USERS_READ),
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.USERS_READ }),
      schema: {
        params: userParams,
        summary: "Get a user's meal plan",
        description:
          "Staff view of a sponsor representative's meal plan, same shape as GET /api/me/meal-plan. " +
          "403 `not_sponsor` when the user is not a sponsor representative.",
        response: { 200: mealPlanResponseSchema },
      },
    },
    async (req) => {
      await assertFixtureSubjectScope(pool, req.userId as number, req.params.id);
      return getMealPlan(pool, req.params.id);
    },
  );

  api.put(
    "/api/users/:id/meal-plan",
    {
      preHandler: [requireCapability(CAPABILITIES.MEAL_PLANS_MANAGE), idempotencyGuard],
      config: routeAccess({ kind: "capability", capability: CAPABILITIES.MEAL_PLANS_MANAGE }),
      schema: {
        params: userParams,
        summary: "Replace a user's meal plan",
        description:
          "Staff correction of a sponsor representative's meal plan. Same body, rules and errors as " +
          "PUT /api/me/meal-plan (locked meals stay closed), except that it is partial: only the " +
          "meals in the body are written, meals left out stay unanswered, and the sponsor's " +
          "`confirmedAt` is not set. Writes one `meal_plan.updated` audit row with the attending " +
          "meal ids before and after, in the same transaction, when any answer changed — also " +
          "when staff correct their own plan here. Accepts `Idempotency-Key`. Requires " +
          "meal-plans:manage.",
        body: mealPlanBodySchema,
        response: { 200: mealPlanResponseSchema },
      },
    },
    async (req) => {
      await assertFixtureSubjectScope(pool, req.userId as number, req.params.id);
      return replaceMealPlan(req.params.id, req.body.meals, { actorId: req.userId as number });
    },
  );
}
