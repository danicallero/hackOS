import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../../db/pool.js";
import { requireAuth } from "../../../lib/capabilities.js";
import { UnauthorizedError } from "../../../lib/errors.js";
import { routeAccessConfig as routeAccess } from "../../../lib/route-policy.js";

/**
 * Generic per-account UI preference store (H59), namespaced by view — e.g.
 * `scheduleTable` holds the schedule management table's column
 * visibility/order. A thin merge-patch over one jsonb column rather than a
 * dedicated table per view; the browser also keeps a localStorage copy for
 * instant reads, this is what makes a preference follow the account across
 * devices. Not a sensitive mutation (own cosmetic prefs only) — no audit.
 */

function actor(userId: number | null): number {
  if (userId == null) throw new UnauthorizedError();
  return userId;
}

const uiPrefsPatchBody = z.object({
  key: z
    .string()
    .min(1)
    .max(60)
    .regex(/^[a-zA-Z0-9_-]+$/, "key must be alphanumeric/_-"),
  value: z.unknown(),
});

export function registerUiPrefsRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/me/ui-prefs",
    {
      preHandler: requireAuth,
      config: routeAccess({ kind: "authenticated" }),
      schema: {
        summary: "Read the caller's UI preferences",
        description:
          "Namespaced per-view UI preference blob (e.g. scheduleTable column visibility/order), so a preference set on one device follows the account to another.",
      },
    },
    async (req) => {
      const { rows } = await pool.query(`SELECT ui_prefs FROM users WHERE id = $1`, [
        actor(req.userId),
      ]);
      return rows[0]?.ui_prefs ?? {};
    },
  );

  r.patch(
    "/api/me/ui-prefs",
    {
      preHandler: requireAuth,
      config: routeAccess({ kind: "authenticated", emailVerification: "none" }),
      schema: {
        body: uiPrefsPatchBody,
        summary: "Merge-patch one namespaced key of the caller's UI preferences",
        description:
          "Sets ui_prefs[key] = value for the caller's own account, leaving every other key untouched.",
      },
    },
    async (req) => {
      const { rows } = await pool.query(
        `UPDATE users
            SET ui_prefs = ui_prefs || jsonb_build_object($2::text, $3::jsonb)
          WHERE id = $1
          RETURNING ui_prefs`,
        [actor(req.userId), req.body.key, JSON.stringify(req.body.value ?? null)],
      );
      return rows[0].ui_prefs;
    },
  );
}
