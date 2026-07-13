import { CAPABILITIES } from "@hackos/shared/capabilities";
import {
  PASS_FIELD_LABEL_KEYS,
  PASS_FIELD_VISIBILITY_KEYS,
  type PassFieldLabels,
  type PassFieldVisibility,
} from "@hackos/shared/wallet-pass-labels";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { config } from "../../config.js";
import { pool } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { requireCapability } from "../../lib/capabilities.js";
import { BadRequestError } from "../../lib/errors.js";
import { bumpAllAppleWalletUpdateTags } from "../logistics/wallet-passes.js";
import { enqueueWalletSync } from "../logistics/wallet-sync.js";

/**
 * Event-wide config (H45/H47). The hacking window is the publicly-"spoken"
 * countdown surfaced on the website and TV panels — distinct from the judging
 * window (queue_settings) and the agenda (schedule). Reads are resilient to a
 * missing singleton; writes upsert it.
 */

const backFieldSchema = z.object({
  label: z.string().min(1).max(80),
  value: z.string().min(1).max(500),
});

const passFieldLabelsSchema = z
  .object(
    Object.fromEntries(PASS_FIELD_LABEL_KEYS.map((key) => [key, z.string().max(60).optional()])),
  )
  .strict();

const passFieldVisibilitySchema = z
  .object(
    Object.fromEntries(PASS_FIELD_VISIBILITY_KEYS.map((key) => [key, z.boolean().optional()])),
  )
  .strict();

const eventConfigBody = z
  .object({
    name: z.string().nullable().optional(),
    tagline: z.string().nullable().optional(),
    timezone: z.string().min(1).optional(),
    eventStartsAt: z.coerce.date().nullable().optional(),
    eventEndsAt: z.coerce.date().nullable().optional(),
    hackingStartsAt: z.coerce.date().nullable().optional(),
    hackingEndsAt: z.coerce.date().nullable().optional(),
    showStartCountdown: z.boolean().optional(),
    venueName: z.string().nullable().optional(),
    venueLatitude: z.number().min(-90).max(90).nullable().optional(),
    venueLongitude: z.number().min(-180).max(180).nullable().optional(),
    passBackFields: z.array(backFieldSchema).max(20).optional(),
    passFieldLabels: passFieldLabelsSchema.optional(),
    passFieldVisibility: passFieldVisibilitySchema.optional(),
  })
  .strict();

const DEFAULTS = {
  name: null,
  tagline: null,
  timezone: "Europe/Madrid",
  event_starts_at: null,
  event_ends_at: null,
  hacking_starts_at: null,
  hacking_ends_at: null,
  show_start_countdown: false,
  venue_name: null,
  venue_latitude: null,
  venue_longitude: null,
  pass_back_fields: [],
  pass_field_labels: {},
  pass_field_visibility: {},
} as const;

interface EventConfigRow {
  name: string | null;
  tagline: string | null;
  timezone: string;
  event_starts_at: string | null;
  event_ends_at: string | null;
  hacking_starts_at: string | null;
  hacking_ends_at: string | null;
  show_start_countdown: boolean;
  venue_name: string | null;
  venue_latitude: number | null;
  venue_longitude: number | null;
  pass_back_fields: { label: string; value: string }[];
  pass_field_labels: PassFieldLabels;
  pass_field_visibility: PassFieldVisibility;
}

async function readConfig(): Promise<EventConfigRow> {
  const { rows } = await pool.query(
    `SELECT name, tagline, timezone, event_starts_at, event_ends_at,
            hacking_starts_at, hacking_ends_at,
            show_start_countdown, venue_name, venue_latitude, venue_longitude,
            pass_back_fields, pass_field_labels, pass_field_visibility
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
    eventStartsAt: row.event_starts_at,
    eventEndsAt: row.event_ends_at,
    hackingStartsAt: row.hacking_starts_at,
    hackingEndsAt: row.hacking_ends_at,
    showStartCountdown: row.show_start_countdown,
    judgingStartsAt: judging.judging_starts_at,
    judgingEndsAt: judging.judging_ends_at,
    venueName: row.venue_name,
    venueLatitude: row.venue_latitude,
    venueLongitude: row.venue_longitude,
    passBackFields: row.pass_back_fields,
    passFieldLabels: row.pass_field_labels,
    passFieldVisibility: row.pass_field_visibility,
    // Read-only: the value the pass's "Organized by" back field is filled
    // with (deploy-time APPLE_PASS_ORGANIZATION), surfaced so the settings
    // page can show it instead of a mystery placeholder.
    organizerName: config.APPLE_PASS_ORGANIZATION,
  };
}

export function registerEventRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Anonymous: the public countdown feed for web / TV.
  r.get(
    "/api/public/event",
    { schema: { summary: "Public event countdown feed (name, hacking/judging window, venue)." } },
    async () => toPublic(await readConfig(), await readJudgingWindow()),
  );

  r.get(
    "/api/event",
    {
      preHandler: requireCapability(CAPABILITIES.SCHEDULE_MANAGE),
      schema: {
        summary: "Read the full event config, including venue and Wallet pass back fields.",
      },
    },
    async () => toPublic(await readConfig(), await readJudgingWindow()),
  );

  r.put(
    "/api/event",
    {
      preHandler: requireCapability(CAPABILITIES.SCHEDULE_MANAGE),
      schema: {
        summary:
          "Update event config: name/tagline/timezone, event start (doors open — the time shown on the Wallet pass), hacking window, venue (name + GPS), the Wallet pass back-field list, field-label overrides, and per-field show/hide toggles. Fields omitted from the body are left unchanged.",
        body: eventConfigBody,
      },
    },
    async (req) => {
      const b = req.body;
      const current = await readConfig();
      const next = {
        name: b.name === undefined ? current.name : b.name,
        tagline: b.tagline === undefined ? current.tagline : b.tagline,
        timezone: b.timezone ?? current.timezone,
        event_starts_at: b.eventStartsAt === undefined ? current.event_starts_at : b.eventStartsAt,
        event_ends_at: b.eventEndsAt === undefined ? current.event_ends_at : b.eventEndsAt,
        hacking_starts_at:
          b.hackingStartsAt === undefined ? current.hacking_starts_at : b.hackingStartsAt,
        hacking_ends_at: b.hackingEndsAt === undefined ? current.hacking_ends_at : b.hackingEndsAt,
        show_start_countdown:
          b.showStartCountdown === undefined ? current.show_start_countdown : b.showStartCountdown,
        venue_name: b.venueName === undefined ? current.venue_name : b.venueName,
        venue_latitude: b.venueLatitude === undefined ? current.venue_latitude : b.venueLatitude,
        venue_longitude:
          b.venueLongitude === undefined ? current.venue_longitude : b.venueLongitude,
        pass_back_fields:
          b.passBackFields === undefined ? current.pass_back_fields : b.passBackFields,
        pass_field_labels:
          b.passFieldLabels === undefined ? current.pass_field_labels : b.passFieldLabels,
        pass_field_visibility:
          b.passFieldVisibility === undefined
            ? current.pass_field_visibility
            : b.passFieldVisibility,
      };

      if (
        next.hacking_starts_at !== null &&
        next.hacking_ends_at !== null &&
        new Date(next.hacking_ends_at).getTime() <= new Date(next.hacking_starts_at).getTime()
      ) {
        throw new BadRequestError("hackingEndsAt must be after hackingStartsAt");
      }
      if (
        next.event_starts_at !== null &&
        next.event_ends_at !== null &&
        new Date(next.event_ends_at).getTime() <= new Date(next.event_starts_at).getTime()
      ) {
        throw new BadRequestError("eventEndsAt must be after eventStartsAt");
      }
      if ((next.venue_latitude === null) !== (next.venue_longitude === null)) {
        throw new BadRequestError("venueLatitude and venueLongitude must be set together");
      }

      const { rows } = await pool.query(
        `INSERT INTO event_config
            (id, name, tagline, timezone, event_starts_at, event_ends_at,
             hacking_starts_at, hacking_ends_at,
             show_start_countdown, venue_name, venue_latitude, venue_longitude,
             pass_back_fields, pass_field_labels, pass_field_visibility)
         VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14::jsonb)
         ON CONFLICT (id) DO UPDATE
            SET name = EXCLUDED.name, tagline = EXCLUDED.tagline, timezone = EXCLUDED.timezone,
                event_starts_at = EXCLUDED.event_starts_at,
                event_ends_at = EXCLUDED.event_ends_at,
                hacking_starts_at = EXCLUDED.hacking_starts_at,
                hacking_ends_at = EXCLUDED.hacking_ends_at,
                show_start_countdown = EXCLUDED.show_start_countdown,
                venue_name = EXCLUDED.venue_name,
                venue_latitude = EXCLUDED.venue_latitude,
                venue_longitude = EXCLUDED.venue_longitude,
                pass_back_fields = EXCLUDED.pass_back_fields,
                pass_field_labels = EXCLUDED.pass_field_labels,
                pass_field_visibility = EXCLUDED.pass_field_visibility
         RETURNING name, tagline, timezone, event_starts_at, event_ends_at,
                   hacking_starts_at, hacking_ends_at,
                   show_start_countdown, venue_name, venue_latitude, venue_longitude,
                   pass_back_fields, pass_field_labels, pass_field_visibility`,
        [
          next.name,
          next.tagline,
          next.timezone,
          next.event_starts_at,
          next.event_ends_at,
          next.hacking_starts_at,
          next.hacking_ends_at,
          next.show_start_countdown,
          next.venue_name,
          next.venue_latitude,
          next.venue_longitude,
          JSON.stringify(next.pass_back_fields),
          JSON.stringify(next.pass_field_labels),
          JSON.stringify(next.pass_field_visibility),
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

      // Apple Wallet passes render event name/venue/back fields fresh from
      // event_config on every fetch — push every issued pass so Wallet
      // refetches now instead of waiting for its next scheduled poll. Only
      // when something actually changed, so clicking Save with no edits
      // doesn't push every device.
      if (JSON.stringify(current) !== JSON.stringify(rows[0])) {
        const passIds = await bumpAllAppleWalletUpdateTags();
        await enqueueWalletSync(passIds);
      }

      return toPublic(rows[0], judging);
    },
  );
}
