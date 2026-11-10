import { ERROR_REASONS } from "@hackos/shared/error-reasons";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { ONBOARDING_STEPS } from "@hackos/shared/onboarding";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireAuth } from "../../lib/capabilities.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../lib/errors.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { routeAccessOption as routeAccess } from "../../lib/route-policy.js";
import { broadcast } from "../../lib/sse.js";
import { readOnboarding } from "./service.js";

const actionBody = z
  .object({
    action: z.enum(["complete", "skip", "defer", "decline"]),
    deferUntil: z.coerce.date().optional(),
  })
  .strict();

export function registerOnboardingModule(app: FastifyInstance): void {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const access = routeAccess({ kind: "authenticated" });
  api.get(
    "/api/me/onboarding",
    {
      ...access,
      preHandler: requireAuth,
      schema: {
        summary: "Read my onboarding",
        description:
          "Resumable current-edition onboarding steps, re-evaluated against current attendance, capability, RSVP and profile facts on every request.",
      },
    },
    async (req) => {
      const { eventKey, revision, steps } = await readOnboarding(pool, req.userId as number);
      return { eventKey, revision, steps };
    },
  );
  api.put(
    "/api/me/onboarding/:step",
    {
      ...access,
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        summary: "Decide an onboarding step",
        description:
          "Persist one current-edition step decision with idempotency, row locking and audit. Declining networking also withdraws directory visibility and consent in the same transaction; deferring never grants consent.",
        params: z.object({ step: z.enum(ONBOARDING_STEPS) }),
        body: actionBody,
      },
    },
    async (req) => {
      const userId = req.userId as number;
      const { step } = req.params;
      const { action, deferUntil } = req.body;
      if ((action === "defer") !== (deferUntil !== undefined)) {
        throw new BadRequestError("deferUntil is required only for defer");
      }
      if (deferUntil && deferUntil <= new Date())
        throw new BadRequestError("deferUntil must be future");
      const result = await withTransaction(async (client) => {
        // The user lock covers a first decision with no state row to lock yet.
        const lockedUser = await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
          userId,
        ]);
        if (!lockedUser.rowCount) throw new NotFoundError("User not found");
        await client.query("SELECT id FROM event_config WHERE id=1 FOR SHARE");
        const current = await readOnboarding(client, userId);
        const resolved = current.steps.find((item) => item.step === step);
        if (!resolved) throw new NotFoundError("Onboarding step not applicable");
        const { rows: previous } = await client.query<{ status: string }>(
          "SELECT status FROM onboarding_step_states WHERE user_id=$1 AND event_key=$2 AND step=$3 FOR UPDATE",
          [userId, current.eventKey, step],
        );
        const recordingExistingFact =
          action === "complete" &&
          resolved.status === "completed" &&
          current.facts.complete[step] === true &&
          previous.length === 0;
        if (
          resolved.status !== "pending" &&
          !recordingExistingFact &&
          !(step === "networking" && action === "decline")
        )
          throw new ConflictError("Onboarding step already decided");
        if (resolved.required && (action === "skip" || action === "decline")) {
          throw new BadRequestError("Required step cannot be skipped or declined", {
            code: ERROR_REASONS.ONBOARDING_STEP_REQUIRED,
          });
        }
        if (action === "complete" && current.facts.complete[step] === false) {
          throw new BadRequestError("Complete the step's underlying task first", {
            code: ERROR_REASONS.ONBOARDING_FACT_INCOMPLETE,
          });
        }
        if (
          step === "completion" &&
          action === "complete" &&
          current.steps.some(
            (item) => item.step !== "completion" && item.required && item.status === "pending",
          )
        ) {
          throw new BadRequestError("Required onboarding steps remain pending", {
            code: ERROR_REASONS.ONBOARDING_STEP_REQUIRED,
          });
        }
        const status =
          action === "complete"
            ? "completed"
            : action === "skip"
              ? "skipped"
              : action === "defer"
                ? "deferred"
                : "declined";
        await client.query(
          `INSERT INTO onboarding_step_states
          (user_id,event_key,step,status,deferred_until,config_revision)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (user_id,event_key,step) DO UPDATE SET
           status=EXCLUDED.status,deferred_until=EXCLUDED.deferred_until,
           config_revision=EXCLUDED.config_revision,decided_at=now()`,
          [userId, current.eventKey, step, status, deferUntil ?? null, current.revision],
        );
        if (step === "networking" && action === "decline") {
          await client.query(
            "UPDATE user_public_profiles SET directory_visible=false,consented_at=NULL WHERE user_id=$1",
            [userId],
          );
        }
        await audit(client, {
          actorId: userId,
          entityType: "onboarding_step_state",
          entityId: `${userId}:${current.eventKey}:${step}`,
          action: "onboarding.step_decided",
          changedFields: [
            "status",
            ...(step === "networking" && action === "decline"
              ? ["directory_visible", "consented_at"]
              : []),
          ],
          before: { status: previous[0]?.status ?? null },
          after: { status },
        });
        return readOnboarding(client, userId);
      });
      await broadcast(`${SSE_TOPICS.USER_PREFIX}${userId}`, EVENTS.USER_SESSION_CHANGED, {});
      return { eventKey: result.eventKey, revision: result.revision, steps: result.steps };
    },
  );
}
