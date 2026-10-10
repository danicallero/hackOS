import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../../db/pool.js";
import { requireAuth } from "../../../lib/capabilities.js";
import { idempotencyGuard } from "../../../lib/idempotency.js";
import { routeAccessConfig as routeAccess } from "../../../lib/route-policy.js";
import { getMealPlan, replaceMealPlan } from "../meal-plan.js";

/** Self-service sponsor meal plan (#933). Benign self-edit: no audit row. */

export const mealPlanResponseSchema = z.object({
  confirmedAt: z.string().nullable(),
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
          "offered to sponsors — meal-kind activities whose schedule entry is shown to the sponsor " +
          "audience or has no audience tags — with the caller's answer (`attending` is null until " +
          "answered) and whether the meal is `locked` because it starts within the event's change " +
          "cutoff (24 h by default). `confirmedAt` is when the plan was first submitted.",
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
          "unlocked meal (400 `meal_plan_incomplete`); an id that is not an offered meal is 400 " +
          "`meal_not_offered`; changing a locked meal is 409 `meal_plan_locked` (echoing its stored " +
          "answer is accepted). Concurrent submissions are serialized per user, so the stored plan " +
          "always matches one whole request. Accepts `Idempotency-Key`. Broadcasts " +
          "`logistics.meal_plan.updated` with the affected activity ids only. Returns the same " +
          "shape as GET.",
        body: mealPlanBodySchema,
        response: { 200: mealPlanResponseSchema },
      },
    },
    async (req) => replaceMealPlan(req.userId as number, req.body.meals),
  );
}
