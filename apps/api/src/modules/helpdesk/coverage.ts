import { pool } from "../../db/pool.js";
import { BadRequestError } from "../../lib/errors.js";
import {
  type HelperKind,
  type HelpTopic,
  KIND_SQL,
  LISTED_HELPER_WHERE,
  presentSql,
} from "./helpers.js";

/**
 * H67 coverage: how many published helpers are scheduled across the event
 * and which topics they cover, plus — for now only — scheduled versus
 * actually present (H24) helpers. Everyone counted is a listed helper
 * (published and eligible); mentors, sponsors and staff all count.
 */

const MAX_SLOTS = 500;

type ByKind = Record<HelperKind, number>;
const emptyByKind = (): ByKind => ({ mentor: 0, sponsor: 0, staff: 0 });

export interface CoverageReport {
  from: string;
  to: string;
  stepMinutes: number;
  totals: { publishedHelpers: number; byKind: ByKind };
  slots: {
    startsAt: string;
    endsAt: string;
    scheduled: number;
    byKind: ByKind;
    topics: { id: number; name: string; scheduled: number }[];
  }[];
  now: {
    at: string;
    scheduled: number;
    present: number;
    available: number;
    topics: { id: number; name: string; scheduled: number; available: number }[];
  };
  uncoveredTopics: HelpTopic[];
}

interface HelperRow {
  user_id: number;
  kind: HelperKind;
  present: boolean;
  topics: HelpTopic[];
  intervals: { s: string; e: string }[];
}

export async function coverageReport(opts: {
  from?: string;
  to?: string;
  stepMinutes: number;
}): Promise<CoverageReport> {
  const { rows: helpers } = await pool.query<HelperRow>(
    `SELECT u.id AS user_id,
            ${KIND_SQL} AS kind,
            ${presentSql("u.id")} AS present,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name))
                        FROM helper_topics ht JOIN help_topics t ON t.id = ht.topic_id
                       WHERE ht.user_id = u.id), '[]'::jsonb) AS topics,
            COALESCE((SELECT jsonb_agg(jsonb_build_object('s', ha.starts_at, 'e', ha.ends_at))
                        FROM helper_availability ha WHERE ha.user_id = u.id), '[]'::jsonb) AS intervals
       FROM helper_profiles hp
       JOIN users u ON u.id = hp.user_id
      WHERE ${LISTED_HELPER_WHERE}`,
  );
  const { rows: meta } = await pool.query<{
    now: Date;
    event_starts_at: Date | null;
    event_ends_at: Date | null;
  }>(
    `SELECT now() AS now, ec.event_starts_at, ec.event_ends_at
       FROM (SELECT 1) one LEFT JOIN event_config ec ON true
      ORDER BY ec.id LIMIT 1`,
  );
  const now = (meta[0] as { now: Date }).now.getTime();
  const parsed = helpers.map((h) => ({
    ...h,
    topics: h.topics.map((t) => ({ id: Number(t.id), name: t.name })),
    intervals: h.intervals.map((i) => ({ s: Date.parse(i.s), e: Date.parse(i.e) })),
  }));

  // Default window: the event, else the span of every stated interval, else
  // today. Defaults snap outward to step boundaries (UTC), so slots read
  // 17:00-18:00 rather than starting at an arbitrary instant; an explicit
  // `from`/`to` is kept as given.
  const allStarts = parsed.flatMap((h) => h.intervals.map((i) => i.s));
  const allEnds = parsed.flatMap((h) => h.intervals.map((i) => i.e));
  const stepMs = opts.stepMinutes * 60_000;
  const floorStep = (t: number) => t - (((t % stepMs) + stepMs) % stepMs);
  const ceilStep = (t: number) => floorStep(t + stepMs - 1);
  const defaultFrom =
    meta[0]?.event_starts_at?.getTime() ?? (allStarts.length ? Math.min(...allStarts) : now);
  const from = opts.from ? Date.parse(opts.from) : floorStep(defaultFrom);
  const defaultTo =
    meta[0]?.event_ends_at?.getTime() ??
    (allEnds.length ? Math.max(...allEnds) : from + 24 * 3_600_000);
  const to = opts.to ? Date.parse(opts.to) : ceilStep(defaultTo);
  if (!(to > from)) throw new BadRequestError("`to` must be after `from`");
  const slotCount = Math.ceil((to - from) / stepMs);
  if (slotCount > MAX_SLOTS) {
    throw new BadRequestError(`At most ${MAX_SLOTS} slots; use a larger step or a shorter range`);
  }

  const totals = { publishedHelpers: parsed.length, byKind: emptyByKind() };
  for (const h of parsed) totals.byKind[h.kind] += 1;

  const slots: CoverageReport["slots"] = [];
  for (let i = 0; i < slotCount; i++) {
    const s = from + i * stepMs;
    const e = Math.min(s + stepMs, to);
    const byKind = emptyByKind();
    const topics = new Map<number, { id: number; name: string; scheduled: number }>();
    let scheduled = 0;
    for (const h of parsed) {
      if (!h.intervals.some((iv) => iv.s < e && iv.e > s)) continue;
      scheduled += 1;
      byKind[h.kind] += 1;
      for (const t of h.topics) {
        const entry = topics.get(t.id) ?? { ...t, scheduled: 0 };
        entry.scheduled += 1;
        topics.set(t.id, entry);
      }
    }
    slots.push({
      startsAt: new Date(s).toISOString(),
      endsAt: new Date(e).toISOString(),
      scheduled,
      byKind,
      topics: [...topics.values()].sort(
        (a, b) => b.scheduled - a.scheduled || a.name.localeCompare(b.name),
      ),
    });
  }

  const nowTopics = new Map<
    number,
    { id: number; name: string; scheduled: number; available: number }
  >();
  let scheduledNow = 0;
  let presentNow = 0;
  let availableNow = 0;
  for (const h of parsed) {
    const sched = h.intervals.some((iv) => iv.s <= now && iv.e > now);
    if (sched) scheduledNow += 1;
    if (h.present) presentNow += 1;
    if (h.present) availableNow += 1;
    for (const t of h.topics) {
      if (!sched && !h.present) continue;
      const entry = nowTopics.get(t.id) ?? { ...t, scheduled: 0, available: 0 };
      if (sched) entry.scheduled += 1;
      if (h.present) entry.available += 1;
      nowTopics.set(t.id, entry);
    }
  }

  // Topics that open requests ask for but no available helper covers now.
  const { rows: uncovered } = await pool.query<{ id: number; name: string }>(
    `SELECT DISTINCT t.id, t.name
       FROM help_requests hr
       JOIN help_request_topics rt ON rt.request_id = hr.id
       JOIN help_topics t ON t.id = rt.topic_id
      WHERE hr.status = 'open'
      ORDER BY t.name, t.id`,
  );
  const covered = new Set([...nowTopics.values()].filter((t) => t.available > 0).map((t) => t.id));

  return {
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    stepMinutes: opts.stepMinutes,
    totals,
    slots,
    now: {
      at: new Date(now).toISOString(),
      scheduled: scheduledNow,
      present: presentNow,
      available: availableNow,
      topics: [...nowTopics.values()].sort(
        (a, b) => b.scheduled - a.scheduled || a.name.localeCompare(b.name),
      ),
    },
    uncoveredTopics: uncovered
      .map((t) => ({ id: Number(t.id), name: t.name }))
      .filter((t) => !covered.has(t.id)),
  };
}
