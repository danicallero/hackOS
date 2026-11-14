import { CAPABILITIES } from "@hackos/shared/capabilities";
import {
  ATTENDANCE_KINDS,
  ONBOARDING_PROFILE_FIELDS,
  ONBOARDING_STEPS,
  type OnboardingConfig,
} from "@hackos/shared/onboarding";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireCapability } from "../../lib/capabilities.js";
import { BadRequestError } from "../../lib/errors.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { routeAccessOption as routeAccess } from "../../lib/route-policy.js";

const stepSettings = z
  .object({
    enabled: z.boolean(),
    required: z.boolean(),
    kinds: z.array(z.enum(ATTENDANCE_KINDS)).max(ATTENDANCE_KINDS.length),
    reaskOnChange: z.boolean(),
  })
  .strict();
const onboardingConfigSchema = z
  .object({
    brand: z
      .object({
        logoUrl: z.string().url().startsWith("https://").max(2048).optional(),
        accentColor: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
      })
      .strict()
      .optional(),
    welcome: stepSettings
      .extend({
        message: z
          .object({ es: z.string().max(1000), gl: z.string().max(1000), en: z.string().max(1000) })
          .optional(),
      })
      .optional(),
    profile: stepSettings
      .extend({
        fields: z
          .array(z.enum(ONBOARDING_PROFILE_FIELDS))
          .max(ONBOARDING_PROFILE_FIELDS.length)
          .optional(),
      })
      .optional(),
    dietary: stepSettings.optional(),
    networking: stepSettings.optional(),
    mentor_profile: stepSettings.optional(),
    rsvp: stepSettings.optional(),
    notifications: stepSettings.optional(),
    share: stepSettings.optional(),
    completion: stepSettings.optional(),
  })
  .strict();

export function registerOnboardingConfigRoutes(app: FastifyInstance): void {
  const api = app.withTypeProvider<ZodTypeProvider>();
  const access = routeAccess({
    kind: "capability",
    capability: CAPABILITIES.EVENT_MANAGE,
    edition: "current",
  });
  api.get(
    "/api/event/onboarding",
    {
      ...access,
      preHandler: requireCapability(CAPABILITIES.EVENT_MANAGE),
      schema: {
        summary: "Read onboarding settings",
        description:
          "Read the current edition's step settings and revision. Welcome text and profile field controls are presentation settings; the step sequence is fixed.",
      },
    },
    async () => {
      const { rows } = await pool.query<{
        event_key: string;
        onboarding_config: OnboardingConfig;
        onboarding_revision: number;
      }>("SELECT event_key,onboarding_config,onboarding_revision FROM event_config WHERE id=1");
      const row = rows[0];
      return {
        eventKey: row?.event_key ?? "default",
        revision: row?.onboarding_revision ?? 1,
        config: row?.onboarding_config ?? {},
      };
    },
  );
  api.put(
    "/api/event/onboarding",
    {
      ...access,
      preHandler: [requireCapability(CAPABILITIES.EVENT_MANAGE), idempotencyGuard],
      schema: {
        summary: "Save onboarding settings",
        description:
          "Save edition onboarding settings atomically. Changing enabled, required or applicable kinds increments the revision and may re-open steps. Networking opt-in can never be required.",
        body: onboardingConfigSchema,
      },
    },
    async (req) => {
      const config = req.body;
      if (config.networking?.required) {
        throw new BadRequestError("Networking consent must remain optional");
      }
      for (const step of ONBOARDING_STEPS) {
        const item = config[step];
        if (item?.required && !item.enabled) {
          throw new BadRequestError(`Required ${step} must be enabled`);
        }
        if (item && new Set(item.kinds).size !== item.kinds.length) {
          throw new BadRequestError(`Duplicate kind in ${step}`);
        }
      }
      return withTransaction(async (client) => {
        await client.query("INSERT INTO event_config (id) VALUES (1) ON CONFLICT DO NOTHING");
        const { rows } = await client.query<{
          event_key: string;
          onboarding_config: OnboardingConfig;
          onboarding_revision: number;
        }>(
          "SELECT event_key,onboarding_config,onboarding_revision FROM event_config WHERE id=1 FOR UPDATE",
        );
        const before = rows[0] ?? {
          event_key: "default",
          onboarding_config: {},
          onboarding_revision: 1,
        };
        const previous = before.onboarding_config;
        const affectsFlow = ONBOARDING_STEPS.some((step) => {
          const old = previous[step];
          const next = config[step];
          return (
            old?.enabled !== next?.enabled ||
            old?.required !== next?.required ||
            JSON.stringify(old?.kinds ?? []) !== JSON.stringify(next?.kinds ?? [])
          );
        });
        const revision = before.onboarding_revision + (affectsFlow ? 1 : 0);
        await client.query(
          "UPDATE event_config SET onboarding_config=$1::jsonb,onboarding_revision=$2 WHERE id=1",
          [JSON.stringify(config), revision],
        );
        await audit(client, {
          actorId: req.userId,
          entityType: "event_config",
          entityId: 1,
          action: "onboarding.config_updated",
          changedFields: ONBOARDING_STEPS.filter(
            (step) => JSON.stringify(previous[step]) !== JSON.stringify(config[step]),
          ),
          before: { revision: before.onboarding_revision },
          after: { revision },
        });
        return { eventKey: before.event_key, revision, config };
      });
    },
  );
}
