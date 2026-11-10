import type { AttendanceKind } from "@hackos/shared/onboarding";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { currentEventKey } from "../event/context.js";
import { broadcastRsvpSettings } from "./broadcast.js";
import { CUTOFF_HOURS_SQL, mealKinds } from "./service.js";
import { type RsvpSummary, rsvpSummaries } from "./summary.js";

/**
 * Organizer RSVP settings of one schedule entry's activity (SCHEDULE_MANAGE).
 * Settings are per event key: switching edition starts with no settings while
 * every earlier answer and configuration stays as history.
 */

export interface RsvpSettings {
  activityId: number;
  scheduleId: number;
  isMeal: boolean;
  enabled: boolean;
  kinds: AttendanceKind[];
  nameI18n: Record<string, string> | null;
  descriptionI18n: Record<string, string> | null;
  rsvpDate: string | null;
  closesAt: string | null;
  /** What blank fields resolve to, so editors can show the effective values. */
  defaults: { name: string; description: string | null; date: string; closesAt: string };
  /** Live counts for the current edition, same eligibility rule as the logistics summary. */
  counts: RsvpSummary | null;
}

export interface RsvpSettingsInput {
  enabled: boolean;
  kinds: AttendanceKind[];
  nameI18n: Record<string, string> | null;
  descriptionI18n: Record<string, string> | null;
  rsvpDate: string | null;
  closesAt: string | null;
}

interface SettingsRow {
  activity_id: number;
  schedule_id: number;
  is_meal: boolean;
  name: string;
  description: string | null;
  starts_at: Date;
  default_closes_at: Date;
  enabled: boolean | null;
  kinds: string[] | null;
  name_i18n: Record<string, string> | null;
  description_i18n: Record<string, string> | null;
  rsvp_date: Date | null;
  closes_at: Date | null;
}

const SETTINGS_SQL = `
  SELECT a.id AS activity_id, a.schedule_id, (a.category = ANY($3::text[])) AS is_meal,
         a.name, a.description, s.starts_at,
         s.starts_at - make_interval(hours => ${CUTOFF_HOURS_SQL}) AS default_closes_at,
         st.enabled, st.kinds, st.name_i18n, st.description_i18n,
         st.rsvp_date, st.closes_at
    FROM activities a
    JOIN schedule s ON s.id = a.schedule_id
    LEFT JOIN activity_rsvp_settings st ON st.activity_id = a.id AND st.event_key = $2
   WHERE a.schedule_id = $1`;

function shape(row: SettingsRow, counts: RsvpSummary | null): RsvpSettings {
  return {
    activityId: row.activity_id,
    scheduleId: row.schedule_id,
    isMeal: row.is_meal,
    enabled: row.enabled ?? false,
    kinds: (row.kinds ?? []) as AttendanceKind[],
    nameI18n: row.name_i18n,
    descriptionI18n: row.description_i18n,
    rsvpDate: row.rsvp_date?.toISOString() ?? null,
    closesAt: row.closes_at?.toISOString() ?? null,
    defaults: {
      name: row.name,
      description: row.description,
      date: row.starts_at.toISOString(),
      closesAt: row.default_closes_at.toISOString(),
    },
    counts,
  };
}

export async function getRsvpSettings(actorId: number, scheduleId: number): Promise<RsvpSettings> {
  const eventKey = await currentEventKey(pool);
  const { rows } = await pool.query<SettingsRow>(SETTINGS_SQL, [scheduleId, eventKey, mealKinds()]);
  if (!rows[0]) throw new NotFoundError("Schedule entry has no activity", { scheduleId });
  const [counts] = await rsvpSummaries(actorId, { activityId: rows[0].activity_id });
  return shape(rows[0], counts ?? null);
}

export function validateRsvpSettings(input: RsvpSettingsInput, isMeal: boolean): void {
  if (input.enabled && input.kinds.length === 0) {
    throw new BadRequestError("Choose who is asked", { code: "rsvp_kinds_required" });
  }
  if (new Set(input.kinds).size !== input.kinds.length) {
    throw new BadRequestError("Duplicate audience", { code: "rsvp_kinds_duplicate" });
  }
  if (isMeal && input.kinds.includes("participant")) {
    throw new BadRequestError("Meals are not offered to participants", {
      code: "rsvp_participants_excluded",
    });
  }
}

function clean(map: Record<string, string> | null): Record<string, string> | null {
  if (!map) return null;
  const entries = Object.entries(map)
    .map(([k, v]) => [k, v.trim()] as const)
    .filter(([, v]) => v.length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

/**
 * Replaces the settings. Existing answers are never touched, and narrowing
 * `kinds` only stops counting/asking the excluded kinds.
 */
export async function putRsvpSettings(
  actorId: number,
  scheduleId: number,
  input: RsvpSettingsInput,
): Promise<RsvpSettings> {
  const activityId = await withTransaction(async (client) => {
    const eventKey = await currentEventKey(client);
    const { rows: activities } = await client.query<{ id: number; is_meal: boolean }>(
      `SELECT id, (category = ANY($2::text[])) AS is_meal FROM activities
        WHERE schedule_id = $1 FOR UPDATE`,
      [scheduleId, mealKinds()],
    );
    const activity = activities[0];
    if (!activity) throw new NotFoundError("Schedule entry has no activity", { scheduleId });
    validateRsvpSettings(input, activity.is_meal);

    const { rows: previous } = await client.query(
      `SELECT enabled, kinds, name_i18n, description_i18n, rsvp_date, closes_at
         FROM activity_rsvp_settings WHERE activity_id = $1 AND event_key = $2 FOR UPDATE`,
      [activity.id, eventKey],
    );
    const next = {
      enabled: input.enabled,
      kinds: [...input.kinds].sort((a, b) => a.localeCompare(b)),
      name_i18n: clean(input.nameI18n),
      description_i18n: clean(input.descriptionI18n),
      rsvp_date: input.rsvpDate ? new Date(input.rsvpDate).toISOString() : null,
      closes_at: input.closesAt ? new Date(input.closesAt).toISOString() : null,
    };
    await client.query(
      `INSERT INTO activity_rsvp_settings
         (activity_id, event_key, enabled, kinds, name_i18n, description_i18n,
          rsvp_date, closes_at)
       VALUES ($1, $2, $3, $4::text[], $5, $6, $7, $8)
       ON CONFLICT (activity_id, event_key) DO UPDATE
         SET enabled = EXCLUDED.enabled, kinds = EXCLUDED.kinds,
             name_i18n = EXCLUDED.name_i18n, description_i18n = EXCLUDED.description_i18n,
             rsvp_date = EXCLUDED.rsvp_date, closes_at = EXCLUDED.closes_at,
             updated_at = now()`,
      [
        activity.id,
        eventKey,
        next.enabled,
        next.kinds,
        next.name_i18n,
        next.description_i18n,
        next.rsvp_date,
        next.closes_at,
      ],
    );
    // Configuration is public event content (R033): safe to keep in the audit trail.
    await audit(client, {
      actorId,
      entityType: "schedule",
      entityId: scheduleId,
      action: "rsvp_settings.updated",
      before: previous[0] ?? null,
      after: next,
    });
    return activity.id;
  });
  await broadcastRsvpSettings([activityId]);
  return getRsvpSettings(actorId, scheduleId);
}
