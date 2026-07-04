import { CAPABILITIES } from "@hackos/shared/capabilities";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { pool } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireCapability } from "../../lib/capabilities.js";
import { BadRequestError } from "../../lib/errors.js";

/**
 * Event-wide config (H45/H47). The hacking window is the publicly-"spoken"
 * countdown surfaced on the website and TV panels — distinct from the judging
 * window (queue_settings) and the agenda (schedule). Reads are resilient to a
 * missing singleton; writes upsert it.
 */

const eventConfigBody = z
  .object({
    name: z.string().nullable().optional(),
    tagline: z.string().nullable().optional(),
    timezone: z.string().min(1).optional(),
    hackingStartsAt: z.coerce.date().nullable().optional(),
    hackingEndsAt: z.coerce.date().nullable().optional(),
  })
  .strict();

const DEFAULTS = {
  name: null,
  tagline: null,
  timezone: "Europe/Madrid",
  hacking_starts_at: null,
  hacking_ends_at: null,
} as const;

interface EventConfigRow {
  name: string | null;
  tagline: string | null;
  timezone: string;
  hacking_starts_at: string | null;
  hacking_ends_at: string | null;
}

async function readConfig(): Promise<EventConfigRow> {
  const { rows } = await pool.query(
    `SELECT name, tagline, timezone, hacking_starts_at, hacking_ends_at
       FROM event_config WHERE id = 1`,
  );
  return rows[0] ?? DEFAULTS;
}

function toPublic(row: EventConfigRow) {
  return {
    name: row.name,
    tagline: row.tagline,
    timezone: row.timezone,
    hackingStartsAt: row.hacking_starts_at,
    hackingEndsAt: row.hacking_ends_at,
  };
}

export function registerEventRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Anonymous: the public countdown feed for web / TV.
  r.get("/api/public/event", async () => toPublic(await readConfig()));

  r.get("/api/event", { preHandler: requireCapability(CAPABILITIES.SCHEDULE_MANAGE) }, async () =>
    toPublic(await readConfig()),
  );

  r.put(
    "/api/event",
    {
      preHandler: requireCapability(CAPABILITIES.SCHEDULE_MANAGE),
      schema: { body: eventConfigBody },
    },
    async (req) => {
      const b = req.body;
      const current = await readConfig();
      const next = {
        name: b.name === undefined ? current.name : b.name,
        tagline: b.tagline === undefined ? current.tagline : b.tagline,
        timezone: b.timezone ?? current.timezone,
        hacking_starts_at:
          b.hackingStartsAt === undefined ? current.hacking_starts_at : b.hackingStartsAt,
        hacking_ends_at: b.hackingEndsAt === undefined ? current.hacking_ends_at : b.hackingEndsAt,
      };

      if (
        next.hacking_starts_at !== null &&
        next.hacking_ends_at !== null &&
        new Date(next.hacking_ends_at).getTime() <= new Date(next.hacking_starts_at).getTime()
      ) {
        throw new BadRequestError("hackingEndsAt must be after hackingStartsAt");
      }

      const { rows } = await pool.query(
        `INSERT INTO event_config (id, name, tagline, timezone, hacking_starts_at, hacking_ends_at)
         VALUES (1, $1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE
            SET name = EXCLUDED.name, tagline = EXCLUDED.tagline, timezone = EXCLUDED.timezone,
                hacking_starts_at = EXCLUDED.hacking_starts_at,
                hacking_ends_at = EXCLUDED.hacking_ends_at
         RETURNING name, tagline, timezone, hacking_starts_at, hacking_ends_at`,
        [next.name, next.tagline, next.timezone, next.hacking_starts_at, next.hacking_ends_at],
      );
      await audit(pool, {
        actorId: req.userId,
        entityType: "event_config",
        entityId: 1,
        action: "updated",
        after: toPublic(rows[0]),
      });
      return toPublic(rows[0]);
    },
  );
}
