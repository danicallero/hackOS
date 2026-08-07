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
import {
  type RouteAccessPolicy,
  routeAccessOption as routeAccess,
} from "../../lib/route-policy.js";
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
    participantsCanCreateProjects: z.boolean().optional(),
    presenceAutoEntryAt: z.coerce.date().nullable().optional(),
    presenceCertaintyWindowMinutes: z.number().int().min(15).max(10080).optional(),
    venueName: z.string().nullable().optional(),
    venueLatitude: z.number().min(-90).max(90).nullable().optional(),
    venueLongitude: z.number().min(-180).max(180).nullable().optional(),
    // H42: shown on the venue screens (GET /api/tv/config), never on the
    // public website feed.
    wifiSsid: z.string().max(64).nullable().optional(),
    wifiPassword: z.string().max(128).nullable().optional(),
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
  participants_can_create_projects: false,
  presence_auto_entry_at: null,
  presence_certainty_window_minutes: 720,
  venue_name: null,
  venue_latitude: null,
  venue_longitude: null,
  wifi_ssid: null,
  wifi_password: null,
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
  participants_can_create_projects: boolean;
  presence_auto_entry_at: string | null;
  presence_certainty_window_minutes: number;
  venue_name: string | null;
  venue_latitude: number | null;
  venue_longitude: number | null;
  wifi_ssid: string | null;
  wifi_password: string | null;
  pass_back_fields: { label: string; value: string }[];
  pass_field_labels: PassFieldLabels;
  pass_field_visibility: PassFieldVisibility;
}

async function readConfig(): Promise<EventConfigRow> {
  const { rows } = await pool.query(
    `SELECT name, tagline, timezone, event_starts_at, event_ends_at,
            hacking_starts_at, hacking_ends_at,
            show_start_countdown, participants_can_create_projects,
            presence_auto_entry_at, presence_certainty_window_minutes,
            venue_name, venue_latitude, venue_longitude,
            wifi_ssid, wifi_password,
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
    // H19: public so participant clients know whether to offer self-creation.
    participantsCanCreateProjects: row.participants_can_create_projects,
    presenceAutoEntryAt: row.presence_auto_entry_at,
    presenceCertaintyWindowMinutes: row.presence_certainty_window_minutes,
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

/**
 * Everything toPublic returns plus the venue Wi-Fi credentials (H42). These
 * are deliberately absent from /api/public/event, which backs the public
 * website; the screens standing in the venue read them from /api/tv/config
 * instead, and the settings page from /api/event.
 */
function toAdmin(
  row: EventConfigRow,
  judging: { judging_starts_at: string | null; judging_ends_at: string | null },
) {
  return {
    ...toPublic(row, judging),
    wifiSsid: row.wifi_ssid,
    wifiPassword: row.wifi_password,
  };
}

export function registerEventRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const publicContent = {
    kind: "public",
    anonymousCategory: "public-content",
  } as const satisfies RouteAccessPolicy;
  const scheduleManage = {
    kind: "capability",
    capability: CAPABILITIES.SCHEDULE_MANAGE,
  } as const satisfies RouteAccessPolicy;

  // Anonymous: the public countdown feed for web / TV.
  r.get(
    "/api/public/event",
    {
      ...routeAccess(publicContent),
      schema: {
        summary: "Public event countdown feed",
        description:
          "Anonymous event identity, public countdown windows and venue projection for website and TV consumers. It never includes venue Wi-Fi credentials.",
      },
    },
    async () => toPublic(await readConfig(), await readJudgingWindow()),
  );

  r.get(
    "/api/event",
    {
      ...routeAccess(scheduleManage),
      preHandler: requireCapability(CAPABILITIES.SCHEDULE_MANAGE),
      schema: {
        summary:
          "Read the full event config, including venue, Wi-Fi credentials and Wallet pass back fields.",
        description:
          "Staff-only counterpart of GET /api/public/event (SCHEDULE_MANAGE). Adds the venue Wi-Fi credentials on top of everything the public feed returns, for the settings page.",
      },
    },
    async () => toAdmin(await readConfig(), await readJudgingWindow()),
  );

  r.put(
    "/api/event",
    {
      ...routeAccess(scheduleManage),
      preHandler: requireCapability(CAPABILITIES.SCHEDULE_MANAGE),
      schema: {
        summary: "Update event config",
        description:
          "Updates name/tagline/timezone, event start (doors open — the time shown on the Wallet pass), hacking window, venue (name + GPS), the Wallet pass back-field list, field-label overrides, per-field show/hide toggles, and whether participants may create their own project (H19). Fields omitted from the body are left unchanged. Issued Apple Wallet passes are pushed a refresh when the saved config actually changes.",
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
        participants_can_create_projects:
          b.participantsCanCreateProjects === undefined
            ? current.participants_can_create_projects
            : b.participantsCanCreateProjects,
        presence_auto_entry_at:
          b.presenceAutoEntryAt === undefined
            ? current.presence_auto_entry_at
            : b.presenceAutoEntryAt,
        presence_certainty_window_minutes:
          b.presenceCertaintyWindowMinutes ?? current.presence_certainty_window_minutes,
        venue_name: b.venueName === undefined ? current.venue_name : b.venueName,
        venue_latitude: b.venueLatitude === undefined ? current.venue_latitude : b.venueLatitude,
        venue_longitude:
          b.venueLongitude === undefined ? current.venue_longitude : b.venueLongitude,
        wifi_ssid: b.wifiSsid === undefined ? current.wifi_ssid : b.wifiSsid,
        wifi_password: b.wifiPassword === undefined ? current.wifi_password : b.wifiPassword,
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
             show_start_countdown, participants_can_create_projects,
             presence_auto_entry_at, presence_certainty_window_minutes,
             venue_name, venue_latitude, venue_longitude,
             wifi_ssid, wifi_password,
             pass_back_fields, pass_field_labels, pass_field_visibility)
         VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18::jsonb, $19::jsonb)
         ON CONFLICT (id) DO UPDATE
            SET name = EXCLUDED.name, tagline = EXCLUDED.tagline, timezone = EXCLUDED.timezone,
                event_starts_at = EXCLUDED.event_starts_at,
                event_ends_at = EXCLUDED.event_ends_at,
                hacking_starts_at = EXCLUDED.hacking_starts_at,
                hacking_ends_at = EXCLUDED.hacking_ends_at,
                show_start_countdown = EXCLUDED.show_start_countdown,
                participants_can_create_projects = EXCLUDED.participants_can_create_projects,
                presence_auto_entry_at = EXCLUDED.presence_auto_entry_at,
                presence_certainty_window_minutes = EXCLUDED.presence_certainty_window_minutes,
                venue_name = EXCLUDED.venue_name,
                venue_latitude = EXCLUDED.venue_latitude,
                venue_longitude = EXCLUDED.venue_longitude,
                wifi_ssid = EXCLUDED.wifi_ssid,
                wifi_password = EXCLUDED.wifi_password,
                pass_back_fields = EXCLUDED.pass_back_fields,
                pass_field_labels = EXCLUDED.pass_field_labels,
                pass_field_visibility = EXCLUDED.pass_field_visibility
         RETURNING name, tagline, timezone, event_starts_at, event_ends_at,
                   hacking_starts_at, hacking_ends_at,
                   show_start_countdown, participants_can_create_projects,
                   presence_auto_entry_at, presence_certainty_window_minutes,
                   venue_name, venue_latitude, venue_longitude,
                   wifi_ssid, wifi_password,
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
          next.participants_can_create_projects,
          next.presence_auto_entry_at,
          next.presence_certainty_window_minutes,
          next.venue_name,
          next.venue_latitude,
          next.venue_longitude,
          next.wifi_ssid,
          next.wifi_password,
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
        // The Wi-Fi password is a credential: audit that it changed, never
        // what it changed to.
        after: { ...toAdmin(rows[0], judging), wifiPassword: rows[0].wifi_password ? "***" : null },
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

      return toAdmin(rows[0], judging);
    },
  );
}
