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
    showStartCountdown: z.boolean().optional(),
  })
  .strict();

const DEFAULTS = {
  name: null,
  tagline: null,
  timezone: "Europe/Madrid",
  hacking_starts_at: null,
  hacking_ends_at: null,
  show_start_countdown: false,
} as const;

interface EventConfigRow {
  name: string | null;
  tagline: string | null;
  timezone: string;
  hacking_starts_at: string | null;
  hacking_ends_at: string | null;
  show_start_countdown: boolean;
}

async function readConfig(): Promise<EventConfigRow> {
  const { rows } = await pool.query(
    `SELECT name, tagline, timezone, hacking_starts_at, hacking_ends_at, show_start_countdown
       FROM event_config WHERE id = 1`,
  );
  return rows[0] ?? DEFAULTS;
}

/**
 * The judging window (queue_settings.schedule_start_at/schedule_end_at) is
 * owned by the queue module (H39's room-pacing input) — this is a read-only
 * passthrough so the public countdown can show "judging starts/ends in" once
 * hacking_ends_at passes.
 */
async function readJudgingWindow(): Promise<{
  judging_starts_at: string | null;
  judging_ends_at: string | null;
}> {
  const { rows } = await pool.query(
    `SELECT schedule_start_at, schedule_end_at FROM queue_settings WHERE id = 1`,
  );
  return {
    judging_starts_at: rows[0]?.schedule_start_at ?? null,
    judging_ends_at: rows[0]?.schedule_end_at ?? null,
  };
}

function toPublic(
  row: EventConfigRow,
  judging: { judging_starts_at: string | null; judging_ends_at: string | null },
) {
  return {
    name: row.name,
    tagline: row.tagline,
    timezone: row.timezone,
    hackingStartsAt: row.hacking_starts_at,
    hackingEndsAt: row.hacking_ends_at,
    showStartCountdown: row.show_start_countdown,
    judgingStartsAt: judging.judging_starts_at,
    judgingEndsAt: judging.judging_ends_at,
  };
}

export function registerEventRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Anonymous: the public countdown feed for web / TV.
  r.get("/api/public/event", async () => toPublic(await readConfig(), await readJudgingWindow()));

  r.get("/api/event", { preHandler: requireCapability(CAPABILITIES.SCHEDULE_MANAGE) }, async () =>
    toPublic(await readConfig(), await readJudgingWindow()),
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
        show_start_countdown:
          b.showStartCountdown === undefined ? current.show_start_countdown : b.showStartCountdown,
      };

      if (
        next.hacking_starts_at !== null &&
        next.hacking_ends_at !== null &&
        new Date(next.hacking_ends_at).getTime() <= new Date(next.hacking_starts_at).getTime()
      ) {
        throw new BadRequestError("hackingEndsAt must be after hackingStartsAt");
      }

      const { rows } = await pool.query(
        `INSERT INTO event_config
            (id, name, tagline, timezone, hacking_starts_at, hacking_ends_at, show_start_countdown)
         VALUES (1, $1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE
            SET name = EXCLUDED.name, tagline = EXCLUDED.tagline, timezone = EXCLUDED.timezone,
                hacking_starts_at = EXCLUDED.hacking_starts_at,
                hacking_ends_at = EXCLUDED.hacking_ends_at,
                show_start_countdown = EXCLUDED.show_start_countdown
         RETURNING name, tagline, timezone, hacking_starts_at, hacking_ends_at, show_start_countdown`,
        [
          next.name,
          next.tagline,
          next.timezone,
          next.hacking_starts_at,
          next.hacking_ends_at,
          next.show_start_countdown,
        ],
      );
      const judging = await readJudgingWindow();
      await audit(pool, {
        actorId: req.userId,
        entityType: "event_config",
        entityId: 1,
        action: "updated",
        after: toPublic(rows[0], judging),
      });
      return toPublic(rows[0], judging);
    },
  );
}
