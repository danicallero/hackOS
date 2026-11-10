import { MEAL_ACTIVITY_KINDS } from "@hackos/shared/activity-kinds";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type { Language } from "@hackos/shared/locale";
import { type Queryable, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { broadcast } from "../../lib/sse.js";
import { currentEventKey } from "../event/context.js";
import { attendanceKind } from "../identity/attendance.js";

/**
 * Per-activity RSVPs (generalises the sponsor meal plans of #933). An activity
 * is offered to a person when it has enabled RSVP settings for the CURRENT
 * event key, its schedule entry is shown and not ended, and the person's
 * attendance kind (derived, participant-first) is in the settings' `kinds`.
 * Meals are never offered to a registered participant, and a person with no
 * classification is never offered anything, whatever the settings say.
 *
 * An answer is a stored row: `attending` true = yes, false = no, NULL =
 * unsure. A missing row is unanswered. Rows are keyed by event_key, so earlier
 * editions stay as history and never leak into the current one.
 */

export type RsvpAnswer = "yes" | "no" | "unsure";

export interface RsvpOption {
  key: string;
  label: string;
}

/** Attendee-facing item (contracts-v2 §6, with `answer` replacing the boolean). */
export interface RsvpItem {
  activityId: number;
  name: string;
  description: string | null;
  date: string;
  closesAt: string;
  location: string | null;
  required: boolean;
  options: RsvpOption[];
  answer: RsvpAnswer | null;
  optionKey: string | null;
  /** Label of the stored option, also when it has been retired. */
  optionLabel: string | null;
  /** Unsure is only accepted on optional items; a required item needs yes or no. */
  allowsUnsure: boolean;
  /** The stored option is no longer configured: it still counts, but must be re-picked to change. */
  optionRetired: boolean;
  locked: boolean;
  isMeal: boolean;
}

export interface OfferedRsvp extends RsvpItem {
  nameI18n: Record<string, string> | null;
  startsAt: string;
  endsAt: string;
  /** A stored row exists (yes, no or unsure). */
  answered: boolean;
}

interface StoredOption {
  key: string;
  label_i18n: Record<string, string>;
  /** Removed by an organizer: kept so past answers keep resolving their label. */
  retired?: boolean;
}

export const CUTOFF_HOURS_SQL = `COALESCE((SELECT meal_plan_cutoff_hours FROM event_config WHERE id = 1), 24)`;

export function mealKinds(): string[] {
  return [...MEAL_ACTIVITY_KINDS];
}

export function answerOf(attending: boolean | null, answered: boolean): RsvpAnswer | null {
  if (!answered) return null;
  if (attending === null) return "unsure";
  return attending ? "yes" : "no";
}

export function attendingOf(answer: RsvpAnswer): boolean | null {
  if (answer === "unsure") return null;
  return answer === "yes";
}

export function pickLabel(label: Record<string, string> | null | undefined, lang: string): string {
  if (!label) return "";
  const hit = [label[lang], label.en, label.es, label.gl, ...Object.values(label)].find(
    (v) => typeof v === "string" && v.trim().length > 0,
  );
  return hit ?? "";
}

function resolveName(
  override: Record<string, string> | null,
  base: { name: string; nameI18n: Record<string, string> | null; primary: string },
  lang: string,
): string {
  const own = override?.[lang]?.trim();
  if (own) return own;
  if (override) {
    const any = pickLabel(override, lang);
    if (any && !base.nameI18n?.[lang]) return any;
  }
  if (lang !== base.primary) {
    const translated = base.nameI18n?.[lang]?.trim() || base.nameI18n?.en?.trim();
    if (translated) return translated;
  }
  return base.name;
}

interface OfferedRow {
  activity_id: number;
  name: string;
  name_i18n: Record<string, string> | null;
  description: string | null;
  description_i18n: Record<string, string> | null;
  primary_language: string;
  starts_at: Date;
  ends_at: Date;
  location: string | null;
  required: boolean;
  options: StoredOption[];
  st_name: Record<string, string> | null;
  st_description: Record<string, string> | null;
  rsvp_date: Date | null;
  closes_at: Date;
  attending: boolean | null;
  option_key: string | null;
  answered: boolean;
  is_meal: boolean;
  locked: boolean;
}

/**
 * Items offered to `userId` right now. `kind` is the caller's attendance kind;
 * null (or participant for meals) yields nothing for the excluded cases.
 */
export async function offeredRsvps(
  db: Queryable,
  userId: number,
  kind: string | null,
  eventKey: string,
  language: Language,
  options: { mealsOnly?: boolean } = {},
): Promise<OfferedRsvp[]> {
  if (!kind) return [];
  const { rows } = await db.query<OfferedRow>(
    `SELECT a.id AS activity_id, a.name, a.name_i18n, a.description, a.description_i18n,
            a.primary_language, s.starts_at, s.ends_at, s.location,
            st.required, st.options, st.name_i18n AS st_name, st.description_i18n AS st_description,
            st.rsvp_date,
            COALESCE(st.closes_at, s.starts_at - make_interval(hours => ${CUTOFF_HOURS_SQL})) AS closes_at,
            r.attending, r.option_key, (r.user_id IS NOT NULL) AS answered,
            (a.category = ANY($4::text[])) AS is_meal,
            now() >= COALESCE(st.closes_at, s.starts_at - make_interval(hours => ${CUTOFF_HOURS_SQL})) AS locked
       FROM activity_rsvp_settings st
       JOIN activities a ON a.id = st.activity_id
       JOIN schedule s ON s.id = a.schedule_id
       LEFT JOIN activity_rsvps r
              ON r.activity_id = a.id AND r.user_id = $1 AND r.event_key = st.event_key
      WHERE st.event_key = $2 AND st.enabled
        AND s.visibility = 'shown' AND s.ends_at > now()
        AND $3::text = ANY(st.kinds)
        AND NOT (a.category = ANY($4::text[]) AND $3::text = 'participant')
        AND (NOT $5::boolean OR a.category = ANY($4::text[]))
      ORDER BY s.starts_at, a.id`,
    [userId, eventKey, kind, mealKinds(), options.mealsOnly ?? false],
  );
  return rows.map((row) => {
    const opts: RsvpOption[] = row.options
      .filter((o) => !o.retired)
      .map((o) => ({ key: o.key, label: pickLabel(o.label_i18n, language) }));
    const stored = row.options.find((o) => o.key === row.option_key);
    return {
      activityId: row.activity_id,
      name: resolveName(
        row.st_name,
        { name: row.name, nameI18n: row.name_i18n, primary: row.primary_language },
        language,
      ),
      description:
        row.st_description && pickLabel(row.st_description, language)
          ? pickLabel(row.st_description, language)
          : row.description,
      date: (row.rsvp_date ?? row.starts_at).toISOString(),
      closesAt: row.closes_at.toISOString(),
      location: row.location,
      required: row.required,
      options: opts,
      answer: answerOf(row.attending, row.answered),
      optionKey: row.answered ? row.option_key : null,
      optionLabel:
        row.answered && row.option_key
          ? stored
            ? pickLabel(stored.label_i18n, language)
            : row.option_key
          : null,
      allowsUnsure: !row.required,
      optionRetired:
        row.answered && row.option_key !== null && !opts.some((o) => o.key === row.option_key),
      locked: row.locked,
      isMeal: row.is_meal,
      nameI18n: row.name_i18n,
      startsAt: row.starts_at.toISOString(),
      endsAt: row.ends_at.toISOString(),
      answered: row.answered,
    };
  });
}

export function toRsvpItem(entry: OfferedRsvp): RsvpItem {
  const { nameI18n: _n, startsAt: _s, endsAt: _e, answered: _a, ...item } = entry;
  return item;
}

async function userLanguage(db: Queryable, userId: number): Promise<Language> {
  const { rows } = await db.query<{ language: Language }>(
    `SELECT language FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0]?.language ?? "en";
}

/** Items for GET /api/me/rsvps and the staff view. */
export async function getRsvps(db: Queryable, userId: number): Promise<RsvpItem[]> {
  const [eventKey, kind, language] = await Promise.all([
    currentEventKey(db),
    attendanceKind(db, userId),
    userLanguage(db, userId),
  ]);
  return (await offeredRsvps(db, userId, kind, eventKey, language)).map(toRsvpItem);
}

/**
 * True when the person has an open (unlocked) offered item with no stored
 * answer. `mealsOnly` keeps the legacy profile-task meaning of "meal plan".
 */
export async function hasPendingRsvps(
  db: Queryable,
  userId: number,
  options: { mealsOnly?: boolean; requiredOnly?: boolean } = {},
): Promise<boolean> {
  const [eventKey, kind, language] = await Promise.all([
    currentEventKey(db),
    attendanceKind(db, userId),
    userLanguage(db, userId),
  ]);
  const items = await offeredRsvps(db, userId, kind, eventKey, language, options);
  return items.some(
    (i) =>
      !i.locked &&
      (i.answer === null || (i.required && i.answer === "unsure")) &&
      (!options.requiredOnly || i.required),
  );
}

export interface RsvpAnswerInput {
  activityId: number;
  answer: RsvpAnswer;
  /** Omitted keeps a still-valid stored option; null clears it. */
  optionKey?: string | null;
}

export interface SubmitOptions {
  /** Staff correction: partial, audited, no required check, no confirmation stamp. */
  actorId?: number;
  /** Legacy meal-plan facade: only meals, every open meal must be answered. */
  mealFacade?: boolean;
}

/**
 * Single write path for every RSVP submission. The user row lock serialises
 * concurrent submissions (several tabs/devices) so the stored answers always
 * match one whole request.
 */
export async function submitRsvps(
  userId: number,
  answers: readonly RsvpAnswerInput[],
  submitOptions: SubmitOptions = {},
): Promise<{ items: OfferedRsvp[]; changed: number[]; mealChanged: number[] }> {
  const { actorId, mealFacade = false } = submitOptions;
  const result = await withTransaction(async (client) => {
    const { rows: userRows } = await client.query(
      `SELECT id FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!userRows[0]) throw new NotFoundError("User not found", { userId });

    const [eventKey, kind, language] = await Promise.all([
      currentEventKey(client),
      attendanceKind(client, userId),
      userLanguage(client, userId),
    ]);
    const mealActivities = new Set<number>();
    if (answers.length > 0) {
      const { rows } = await client.query<{ id: number; is_meal: boolean }>(
        `SELECT id, (category = ANY($2::text[])) AS is_meal FROM activities WHERE id = ANY($1::int[])`,
        [answers.map((a) => a.activityId), mealKinds()],
      );
      for (const row of rows) if (row.is_meal) mealActivities.add(row.id);
    }
    // Participants are never offered food, whatever the settings say.
    if (kind === "participant") {
      const denied = answers.find((a) => mealActivities.has(a.activityId));
      if (denied) {
        throw new ForbiddenError("Meals are not offered to participants", {
          code: "rsvp_participants_excluded",
          activityId: denied.activityId,
        });
      }
    }

    const before = await offeredRsvps(client, userId, kind, eventKey, language, {
      mealsOnly: mealFacade,
    });
    const offered = new Map(before.map((m) => [m.activityId, m]));
    const writes = new Map<number, { attending: boolean | null; optionKey: string | null }>();

    for (const input of answers) {
      const item = offered.get(input.activityId);
      if (!item) {
        const { rows } = await client.query<{ gone: boolean }>(
          `SELECT (NOT st.enabled OR s.ends_at <= now() OR s.visibility <> 'shown') AS gone
             FROM activity_rsvp_settings st
             JOIN activities a ON a.id = st.activity_id
             JOIN schedule s ON s.id = a.schedule_id
            WHERE st.activity_id = $1 AND st.event_key = $2
              AND $3::text = ANY(st.kinds)
              AND (NOT $4::boolean OR a.category = ANY($5::text[]))`,
          [input.activityId, eventKey, kind ?? "", mealFacade, mealKinds()],
        );
        // Ended, hidden or switched off since the list was loaded: nothing to store.
        if (rows[0]?.gone) continue;
        throw new BadRequestError("This item is not offered to you", {
          code: mealFacade ? "meal_not_offered" : "rsvp_not_offered",
          activityId: input.activityId,
        });
      }

      if (input.answer === "unsure" && !item.allowsUnsure) {
        throw new BadRequestError("A required RSVP needs a yes or no", {
          code: "rsvp_unsure_not_allowed",
          activityId: input.activityId,
        });
      }
      const attending = attendingOf(input.answer);
      let optionKey: string | null = null;
      if (attending === true && item.options.length > 0) {
        const given =
          input.optionKey === undefined
            ? item.optionKey !== null && !item.optionRetired
              ? item.optionKey
              : null
            : input.optionKey;
        // An unchanged retired option may be echoed back; picking one needs a live option.
        const keepsRetired =
          given !== null && given === item.optionKey && item.optionRetired && item.answer === "yes";
        if (given === null || (!keepsRetired && !item.options.some((o) => o.key === given))) {
          throw new BadRequestError("Choose one of the options", {
            code: "rsvp_option_required",
            activityId: input.activityId,
          });
        }
        optionKey = given;
      } else if (input.optionKey !== undefined && input.optionKey !== null) {
        throw new BadRequestError("This answer takes no option", {
          code: "rsvp_option_invalid",
          activityId: input.activityId,
        });
      }

      const unchanged =
        item.answered &&
        (item.answer === "yes" ? true : item.answer === "no" ? false : null) === attending &&
        item.optionKey === optionKey;
      if (item.locked) {
        if (unchanged) continue;
        // The legacy facade never rejected an answer for a locked meal nobody answered.
        if (mealFacade && !item.answered) continue;
        throw new ConflictError("Changes to this RSVP are closed", {
          code: "rsvp_locked",
          activityId: input.activityId,
        });
      }
      writes.set(input.activityId, { attending, optionKey });
    }

    if (!actorId) {
      const open = before.filter((m) => !m.locked);
      const missing = open.filter((m) =>
        mealFacade
          ? !answers.some((a) => a.activityId === m.activityId)
          : m.required && (m.answer === null || m.answer === "unsure") && !writes.has(m.activityId),
      );
      if (missing.length > 0) {
        throw new BadRequestError("Answer every required item", {
          code: mealFacade ? "meal_plan_incomplete" : "rsvp_incomplete",
          activityIds: missing.map((m) => m.activityId),
        });
      }
    }

    const ids = [...writes.keys()];
    let changed: number[] = [];
    if (ids.length > 0) {
      const { rows } = await client.query<{ activity_id: number }>(
        `INSERT INTO activity_rsvps (user_id, activity_id, event_key, attending, option_key)
         SELECT $1, t.activity_id, $2, t.attending, t.option_key
           FROM unnest($3::int[], $4::boolean[], $5::text[]) AS t(activity_id, attending, option_key)
         ON CONFLICT (user_id, activity_id, event_key)
           DO UPDATE SET attending = EXCLUDED.attending, option_key = EXCLUDED.option_key
         WHERE (activity_rsvps.attending, activity_rsvps.option_key)
               IS DISTINCT FROM (EXCLUDED.attending, EXCLUDED.option_key)
         RETURNING activity_id`,
        [
          userId,
          eventKey,
          ids,
          ids.map((id) => writes.get(id)?.attending ?? null),
          ids.map((id) => writes.get(id)?.optionKey ?? null),
        ],
      );
      changed = rows.map((row) => row.activity_id);
    }

    if (actorId && changed.length > 0) {
      const attendingAfter = before
        .filter((m) =>
          changed.includes(m.activityId)
            ? writes.get(m.activityId)?.attending === true
            : m.answer === "yes",
        )
        .map((m) => m.activityId);
      await audit(client, {
        actorId,
        entityType: "user",
        entityId: userId,
        action: mealFacade ? "meal_plan.updated" : "rsvp.updated",
        source: "admin",
        before: { attending: before.filter((m) => m.answer === "yes").map((m) => m.activityId) },
        after: { attending: attendingAfter },
      });
    }
    if (!actorId && mealFacade) {
      await client.query(
        `UPDATE users SET meal_plan_confirmed_at = COALESCE(meal_plan_confirmed_at, now())
          WHERE id = $1`,
        [userId],
      );
    }
    const items = await offeredRsvps(client, userId, kind, eventKey, language, {
      mealsOnly: mealFacade,
    });
    return {
      items,
      changed,
      mealChanged: changed.filter((id) => items.some((i) => i.activityId === id && i.isMeal)),
    };
  });
  if (result.changed.length > 0) {
    await broadcast(SSE_TOPICS.LOGISTICS, EVENTS.LOGISTICS_RSVP_UPDATED, {
      activityIds: result.changed,
    });
  }
  if (result.mealChanged.length > 0) {
    await broadcast(SSE_TOPICS.LOGISTICS, EVENTS.LOGISTICS_MEAL_PLAN_UPDATED, {
      activityIds: result.mealChanged,
    });
  }
  return result;
}
