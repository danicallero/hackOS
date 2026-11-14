import type { AttendanceKind } from "@hackos/shared/onboarding";
import { pool } from "../../db/pool.js";
import { toCsv } from "../../lib/csv.js";
import { NotFoundError } from "../../lib/errors.js";
import { fixtureReadFilter } from "../../lib/fixture-subject-scope.js";
import { currentEventKey } from "../event/context.js";
import { mealKinds } from "./service.js";

/**
 * Logistics read side of RSVPs. Counted people are active, non-anonymized
 * accounts on the reader's side of the review-fixture boundary, whose derived
 * attendance kind is in the activity's `kinds` or who hold one of its `role_ids` (meals never count a
 * participant): the same rule that decides who is offered the RSVP. Answers
 * from people no longer eligible, and from earlier editions, are not counted.
 */

export interface KindCounts {
  attending: number;
  notAttending: number;
  unsure: number;
  unanswered: number;
}

export interface RsvpSummary extends KindCounts {
  activityId: number;
  scheduleId: number;
  name: string;
  nameI18n: Record<string, string>;
  startsAt: string;
  isMeal: boolean;
  eligible: number;
  byKind: Partial<Record<AttendanceKind, KindCounts>>;
  /** Among people attending, one entry per declared intolerance. */
  intolerances: Array<{ id: number; label: Record<string, string>; n: number }>;
  /** People attending with free-text dietary notes. */
  withNotes: number;
}

const zero = (): KindCounts => ({ attending: 0, notAttending: 0, unsure: 0, unanswered: 0 });

/** CTE `people`: eligible-side accounts with their derived kind. */
async function peopleSql(actorId: number, eventKeyParam: string): Promise<string> {
  const fixtureFilter = await fixtureReadFilter(pool, actorId, "u");
  return `
  people AS (
    SELECT u.id, k.kind, u.food_intolerances, u.food_intolerance_notes,
           ARRAY(SELECT ur.role_id FROM user_roles ur JOIN roles ro ON ro.id = ur.role_id AND ro.deleted_at IS NULL AND (ur.event_key IS NULL OR ur.event_key = current_edition())
                  WHERE ur.user_id = u.id) AS role_ids
      FROM users u
      JOIN event_attendance_kinds k ON k.user_id = u.id AND k.event_key = ${eventKeyParam}
     WHERE u.account_state = 'active' AND u.anonymized_at IS NULL${fixtureFilter}
  )`;
}

const ELIGIBLE_JOIN = `
  JOIN people p ON (p.kind = ANY(st.kinds) OR p.role_ids && st.role_ids)
               AND NOT (a.category = ANY($3::text[]) AND p.kind = 'participant')`;

export async function rsvpSummaries(
  actorId: number,
  options: { activityId?: number; mealsOnly?: boolean } = {},
): Promise<RsvpSummary[]> {
  const eventKey = await currentEventKey(pool);
  const params = [eventKey, options.activityId ?? null, mealKinds(), options.mealsOnly ?? false];
  const { rows: activities } = await pool.query<{
    id: number;
    schedule_id: number;
    name: string;
    name_i18n: Record<string, string> | null;
    starts_at: Date;
    is_meal: boolean;
  }>(
    `SELECT a.id, a.schedule_id, a.name, a.name_i18n, s.starts_at,
            (a.category = ANY($3::text[])) AS is_meal
       FROM activity_rsvp_settings st
       JOIN activities a ON a.id = st.activity_id
       JOIN schedule s ON s.id = a.schedule_id AND s.visibility = 'shown'
      WHERE st.event_key = $1 AND st.enabled AND (cardinality(st.kinds) > 0 OR cardinality(st.role_ids) > 0)
        AND ($2::int IS NULL OR a.id = $2)
        AND (NOT $4::boolean OR a.category = ANY($3::text[]))
      ORDER BY s.starts_at, a.id`,
    params,
  );
  if (activities.length === 0) return [];
  const ids = activities.map((a) => a.id);
  const people = await peopleSql(actorId, "$1");

  const { rows: counts } = await pool.query<{
    activity_id: number;
    kind: AttendanceKind;
    state: "yes" | "no" | "unsure" | "unanswered";
    n: number;
    with_notes: number;
  }>(
    `WITH ${people}
     SELECT st.activity_id, p.kind,
            CASE WHEN r.user_id IS NULL THEN 'unanswered'
                 WHEN r.attending IS NULL THEN 'unsure'
                 WHEN r.attending THEN 'yes' ELSE 'no' END AS state,
            count(*)::int AS n,
            count(*) FILTER (WHERE r.attending
              AND btrim(coalesce(p.food_intolerance_notes, '')) <> '')::int AS with_notes
       FROM activity_rsvp_settings st
       JOIN activities a ON a.id = st.activity_id
       ${ELIGIBLE_JOIN}
       LEFT JOIN activity_rsvps r
              ON r.activity_id = st.activity_id AND r.user_id = p.id AND r.event_key = st.event_key
      WHERE st.event_key = $1 AND st.activity_id = ANY($2::int[])
      GROUP BY st.activity_id, p.kind, state`,
    [eventKey, ids, mealKinds()],
  );
  const { rows: intolerances } = await pool.query<{
    activity_id: number;
    id: number;
    label: Record<string, string>;
    n: number;
  }>(
    `WITH ${people}
     SELECT st.activity_id, fi.id, fi.label, count(*)::int AS n
       FROM activity_rsvp_settings st
       JOIN activities a ON a.id = st.activity_id
       ${ELIGIBLE_JOIN}
       JOIN activity_rsvps r
         ON r.activity_id = st.activity_id AND r.user_id = p.id AND r.event_key = st.event_key
       JOIN LATERAL unnest(p.food_intolerances) AS ui(id) ON true
       JOIN food_intolerances fi ON fi.id = ui.id
      WHERE st.event_key = $1 AND r.attending AND st.activity_id = ANY($2::int[])
      GROUP BY st.activity_id, fi.id, fi.label
      ORDER BY n DESC, fi.id`,
    [eventKey, ids, mealKinds()],
  );

  return activities.map((activity) => {
    const total = zero();
    const byKind: Partial<Record<AttendanceKind, KindCounts>> = {};
    let withNotes = 0;
    let eligible = 0;
    for (const row of counts.filter((c) => c.activity_id === activity.id)) {
      let kindCounts = byKind[row.kind];
      if (!kindCounts) {
        kindCounts = zero();
        byKind[row.kind] = kindCounts;
      }
      const slot =
        row.state === "yes"
          ? "attending"
          : row.state === "no"
            ? "notAttending"
            : row.state === "unsure"
              ? "unsure"
              : "unanswered";
      kindCounts[slot] += row.n;
      total[slot] += row.n;
      eligible += row.n;
      withNotes += row.with_notes;
    }
    return {
      activityId: activity.id,
      scheduleId: activity.schedule_id,
      name: activity.name,
      nameI18n: activity.name_i18n ?? {},
      startsAt: activity.starts_at.toISOString(),
      isMeal: activity.is_meal,
      eligible,
      ...total,
      byKind,
      intolerances: intolerances
        .filter((i) => i.activity_id === activity.id)
        .map((i) => ({ id: i.id, label: i.label, n: i.n })),
      withNotes,
    };
  });
}

function intoleranceLabel(label: Record<string, string>, language: string): string {
  return label[language] ?? label.en ?? label.es ?? Object.values(label)[0] ?? "";
}

/**
 * Catering CSV for one activity: one row per eligible person attending, with
 * kind, enterprise(s), intolerance labels (in `language`) and notes.
 */
export async function exportRsvpCsv(
  actorId: number,
  activityId: number,
  language: string,
  options: { mealsOnly?: boolean } = {},
): Promise<string> {
  const eventKey = await currentEventKey(pool);
  const people = await peopleSql(actorId, "$1");
  const { rowCount } = await pool.query(
    `SELECT 1 FROM activity_rsvp_settings st JOIN activities a ON a.id = st.activity_id
       JOIN schedule s ON s.id = a.schedule_id AND s.visibility = 'shown'
      WHERE st.event_key = $1 AND st.enabled AND (cardinality(st.kinds) > 0 OR cardinality(st.role_ids) > 0) AND a.id = $2
        AND (NOT $4::boolean OR a.category = ANY($3::text[]))`,
    [eventKey, activityId, mealKinds(), options.mealsOnly ?? false],
  );
  if (!rowCount) throw new NotFoundError("Activity not found", { activityId });
  const { rows } = await pool.query<{
    name: string | null;
    surname: string | null;
    kind: string;
    enterprises: string | null;
    labels: Record<string, string>[] | null;
    notes: string | null;
  }>(
    `WITH ${people}
     SELECT u.name, u.surname, p.kind,
            (SELECT string_agg(DISTINCT e.name, '; ')
               FROM sponsors sp JOIN enterprises e ON e.id = sp.enterprise_id
              WHERE sp.user_id = p.id) AS enterprises,
            (SELECT array_agg(fi.label ORDER BY fi.id)
               FROM food_intolerances fi WHERE fi.id = ANY(p.food_intolerances)) AS labels,
            nullif(btrim(p.food_intolerance_notes), '') AS notes
       FROM activity_rsvp_settings st
       JOIN activities a ON a.id = st.activity_id
       ${ELIGIBLE_JOIN}
       JOIN activity_rsvps r
         ON r.activity_id = st.activity_id AND r.user_id = p.id AND r.event_key = st.event_key
       JOIN users u ON u.id = p.id
      WHERE st.event_key = $1 AND st.activity_id = $2 AND r.attending
      ORDER BY u.surname NULLS LAST, u.name NULLS LAST, u.id`,
    [eventKey, activityId, mealKinds()],
  );
  return toCsv(
    ["name", "surname", "enterprise", "intolerances", "notes", "kind"],
    rows.map((r) => [
      r.name,
      r.surname,
      r.enterprises,
      (r.labels ?? []).map((l) => intoleranceLabel(l, language)).join("; "),
      r.notes,
      r.kind,
    ]),
  );
}

export interface RsvpPerson {
  userId: number;
  name: string | null;
  surname: string | null;
  kind: AttendanceKind;
  enterprise: string | null;
  state: "yes" | "no" | "unsure" | "unanswered";
}

/**
 * Who was asked about one activity and what each person answered: the same
 * eligible people the counts use, one row each, including the unanswered. No
 * dietary data (that stays in the catering export).
 */
export async function rsvpPeople(actorId: number, activityId: number): Promise<RsvpPerson[]> {
  const eventKey = await currentEventKey(pool);
  const people = await peopleSql(actorId, "$1");
  const { rowCount } = await pool.query(
    `SELECT 1 FROM activity_rsvp_settings st JOIN activities a ON a.id = st.activity_id
       JOIN schedule s ON s.id = a.schedule_id AND s.visibility = 'shown'
      WHERE st.event_key = $1 AND st.enabled AND (cardinality(st.kinds) > 0 OR cardinality(st.role_ids) > 0) AND a.id = $2`,
    [eventKey, activityId],
  );
  if (!rowCount) throw new NotFoundError("Activity not found", { activityId });
  const { rows } = await pool.query<{
    id: number;
    name: string | null;
    surname: string | null;
    kind: AttendanceKind;
    enterprise: string | null;
    state: RsvpPerson["state"];
  }>(
    `WITH ${people}
     SELECT u.id, u.name, u.surname, p.kind,
            (SELECT string_agg(DISTINCT e.name, '; ')
               FROM sponsors sp JOIN enterprises e ON e.id = sp.enterprise_id
              WHERE sp.user_id = p.id) AS enterprise,
            CASE WHEN r.user_id IS NULL THEN 'unanswered'
                 WHEN r.attending IS NULL THEN 'unsure'
                 WHEN r.attending THEN 'yes' ELSE 'no' END AS state
       FROM activity_rsvp_settings st
       JOIN activities a ON a.id = st.activity_id
       ${ELIGIBLE_JOIN}
       JOIN users u ON u.id = p.id
       LEFT JOIN activity_rsvps r
              ON r.activity_id = st.activity_id AND r.user_id = p.id AND r.event_key = st.event_key
      WHERE st.event_key = $1 AND st.activity_id = $2
      ORDER BY u.surname NULLS LAST, u.name NULLS LAST, u.id`,
    [eventKey, activityId, mealKinds()],
  );
  return rows.map((r) => ({
    userId: r.id,
    name: r.name,
    surname: r.surname,
    kind: r.kind,
    enterprise: r.enterprise,
    state: r.state,
  }));
}

export interface DietaryOverview {
  people: number;
  withRestrictions: number;
  withNotes: number;
  byIntolerance: Array<{ id: number; label: Record<string, string>; n: number }>;
  entries: Array<{
    userId: number;
    name: string | null;
    surname: string | null;
    kind: AttendanceKind;
    enterprise: string | null;
    intolerances: Array<{ id: number; label: Record<string, string> }>;
    notes: string | null;
  }>;
}

/**
 * Every current attendee's declared food intolerances and free-text notes, for
 * catering: the same people the RSVP counts consider (active, non-anonymized,
 * current attendance kind, reviewer-fixture boundary). Only people with
 * something to report are listed; `people` is everyone considered.
 */
export async function dietaryOverview(actorId: number): Promise<DietaryOverview> {
  const eventKey = await currentEventKey(pool);
  const people = await peopleSql(actorId, "$1");
  const { rows } = await pool.query<{
    id: number;
    name: string | null;
    surname: string | null;
    kind: AttendanceKind;
    enterprise: string | null;
    labels: Array<{ id: number; label: Record<string, string> }> | null;
    notes: string | null;
  }>(
    `WITH ${people}
     SELECT u.id, u.name, u.surname, p.kind,
            (SELECT string_agg(DISTINCT e.name, '; ')
               FROM sponsors sp JOIN enterprises e ON e.id = sp.enterprise_id
              WHERE sp.user_id = p.id) AS enterprise,
            (SELECT jsonb_agg(jsonb_build_object('id', fi.id, 'label', fi.label) ORDER BY fi.id)
               FROM food_intolerances fi WHERE fi.id = ANY(p.food_intolerances)) AS labels,
            nullif(btrim(p.food_intolerance_notes), '') AS notes
       FROM people p JOIN users u ON u.id = p.id
      ORDER BY u.surname NULLS LAST, u.name NULLS LAST, u.id`,
    [eventKey],
  );
  const byIntolerance = new Map<number, { id: number; label: Record<string, string>; n: number }>();
  const entries: DietaryOverview["entries"] = [];
  for (const row of rows) {
    const intolerances = row.labels ?? [];
    if (intolerances.length === 0 && !row.notes) continue;
    for (const item of intolerances) {
      const found = byIntolerance.get(item.id) ?? { id: item.id, label: item.label, n: 0 };
      found.n += 1;
      byIntolerance.set(item.id, found);
    }
    entries.push({
      userId: row.id,
      name: row.name,
      surname: row.surname,
      kind: row.kind,
      enterprise: row.enterprise,
      intolerances,
      notes: row.notes,
    });
  }
  return {
    people: rows.length,
    withRestrictions: entries.filter((e) => e.intolerances.length > 0).length,
    withNotes: entries.filter((e) => e.notes).length,
    byIntolerance: [...byIntolerance.values()].sort((a, b) => b.n - a.n || a.id - b.id),
    entries,
  };
}
