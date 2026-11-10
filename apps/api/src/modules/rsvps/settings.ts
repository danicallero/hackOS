import type { AttendanceKind } from "@hackos/shared/onboarding";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";
import { currentEventKey } from "../event/context.js";
import { CUTOFF_HOURS_SQL, mealKinds } from "./service.js";

interface StoredOption {
  key: string;
  label_i18n: Record<string, string>;
  retired?: boolean;
}

import { broadcastRsvpSettings } from "./broadcast.js";
import { type RsvpSummary, rsvpSummaries } from "./summary.js";

/**
 * Organizer RSVP settings of one schedule entry's activity (SCHEDULE_MANAGE).
 * Settings are per event key: switching edition starts with no settings while
 * every earlier answer and configuration stays as history.
 */

export interface RsvpOptionConfig {
  key: string;
  labelI18n: Record<string, string>;
}

export interface RsvpSettings {
  activityId: number;
  scheduleId: number;
  isMeal: boolean;
  enabled: boolean;
  required: boolean;
  kinds: AttendanceKind[];
  nameI18n: Record<string, string> | null;
  descriptionI18n: Record<string, string> | null;
  rsvpDate: string | null;
  closesAt: string | null;
  options: Array<RsvpOptionConfig & { retired: boolean }>;
  /** What blank fields resolve to, so editors can show the effective values. */
  defaults: { name: string; description: string | null; date: string; closesAt: string };
  /** Live counts for the current edition, same eligibility rule as the logistics summary. */
  counts: RsvpSummary | null;
}

export interface RsvpSettingsInput {
  enabled: boolean;
  required: boolean;
  kinds: AttendanceKind[];
  nameI18n: Record<string, string> | null;
  descriptionI18n: Record<string, string> | null;
  rsvpDate: string | null;
  closesAt: string | null;
  options: RsvpOptionConfig[];
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
  required: boolean | null;
  kinds: string[] | null;
  name_i18n: Record<string, string> | null;
  description_i18n: Record<string, string> | null;
  rsvp_date: Date | null;
  closes_at: Date | null;
  options: { key: string; label_i18n: Record<string, string>; retired?: boolean }[] | null;
}

const SETTINGS_SQL = `
  SELECT a.id AS activity_id, a.schedule_id, (a.category = ANY($3::text[])) AS is_meal,
         a.name, a.description, s.starts_at,
         s.starts_at - make_interval(hours => ${CUTOFF_HOURS_SQL}) AS default_closes_at,
         st.enabled, st.required, st.kinds, st.name_i18n, st.description_i18n,
         st.rsvp_date, st.closes_at, st.options
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
    required: row.required ?? false,
    kinds: (row.kinds ?? []) as AttendanceKind[],
    nameI18n: row.name_i18n,
    descriptionI18n: row.description_i18n,
    rsvpDate: row.rsvp_date?.toISOString() ?? null,
    closesAt: row.closes_at?.toISOString() ?? null,
    options: (row.options ?? []).map((o) => ({
      key: o.key,
      labelI18n: o.label_i18n,
      retired: o.retired === true,
    })),
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

function validate(input: RsvpSettingsInput, isMeal: boolean): void {
  if (input.required && !input.enabled) {
    throw new BadRequestError("A required RSVP must be enabled", {
      code: "rsvp_required_needs_enabled",
    });
  }
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
  if (new Set(input.options.map((o) => o.key)).size !== input.options.length) {
    throw new BadRequestError("Duplicate option key", { code: "rsvp_option_duplicate" });
  }
  for (const option of input.options) {
    if (!Object.values(option.labelI18n).some((v) => v.trim().length > 0)) {
      throw new BadRequestError("Every option needs a label", {
        code: "rsvp_option_label_required",
        key: option.key,
      });
    }
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
 * Replaces the settings. Existing answers are never touched: options removed
 * here stay on stored answers (shown as retired), and narrowing `kinds` only
 * stops counting/asking the excluded kinds.
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
    validate(input, activity.is_meal);

    const { rows: previous } = await client.query(
      `SELECT enabled, required, kinds, name_i18n, description_i18n, rsvp_date, closes_at, options
         FROM activity_rsvp_settings WHERE activity_id = $1 AND event_key = $2 FOR UPDATE`,
      [activity.id, eventKey],
    );
    const next = {
      enabled: input.enabled,
      required: input.required,
      kinds: [...input.kinds].sort(),
      name_i18n: clean(input.nameI18n),
      description_i18n: clean(input.descriptionI18n),
      rsvp_date: input.rsvpDate ? new Date(input.rsvpDate).toISOString() : null,
      closes_at: input.closesAt ? new Date(input.closesAt).toISOString() : null,
      // Options are never deleted: one left out is retired so past answers keep their label.
      options: [
        ...input.options.map((o) => ({ key: o.key, label_i18n: clean(o.labelI18n) ?? {} })),
        ...((previous[0]?.options ?? []) as StoredOption[])
          .filter((old) => !input.options.some((o) => o.key === old.key))
          .map((old) => ({ key: old.key, label_i18n: old.label_i18n, retired: true })),
      ],
    };
    await client.query(
      `INSERT INTO activity_rsvp_settings
         (activity_id, event_key, enabled, required, kinds, name_i18n, description_i18n,
          rsvp_date, closes_at, options)
       VALUES ($1, $2, $3, $4, $5::text[], $6, $7, $8, $9, $10::jsonb)
       ON CONFLICT (activity_id, event_key) DO UPDATE
         SET enabled = EXCLUDED.enabled, required = EXCLUDED.required, kinds = EXCLUDED.kinds,
             name_i18n = EXCLUDED.name_i18n, description_i18n = EXCLUDED.description_i18n,
             rsvp_date = EXCLUDED.rsvp_date, closes_at = EXCLUDED.closes_at,
             options = EXCLUDED.options, updated_at = now()`,
      [
        activity.id,
        eventKey,
        next.enabled,
        next.required,
        next.kinds,
        next.name_i18n,
        next.description_i18n,
        next.rsvp_date,
        next.closes_at,
        JSON.stringify(next.options),
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
