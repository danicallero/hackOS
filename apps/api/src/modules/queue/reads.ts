import { pool } from "../../db/pool.js";
import { NotFoundError } from "../../lib/errors.js";
import { REPO_MEMBER_RELATION_SQL } from "./membership.js";

const QUEUE_ENTRY_SELECT = `qe.*, r.name AS repo_name, r.description AS repo_description,
  r.github_url AS repo_github_url, r.devpost_url AS repo_devpost_url, r.demo_url AS repo_demo_url,
  COALESCE(
    (
      SELECT jsonb_agg(
               m ORDER BY (m->>'name') ASC NULLS LAST, (m->>'surname') ASC NULLS LAST, (m->>'email') ASC
             )
        FROM (
          SELECT jsonb_build_object(
                   'userId', dp.user_id,
                   'email', dp.email,
                   'name', COALESCE(u.name, dp.name),
                   'surname', COALESCE(u.surname, dp.surname),
                   'source', 'devpost',
                   'matchType', CASE
                     WHEN dp.user_id IS NULL THEN 'unmatched'
                     WHEN lower(dp.email) = lower(u.email) THEN 'primary_email'
                     WHEN u.secondary_email_verified_at IS NOT NULL
                       AND lower(dp.email) = lower(u.secondary_email) THEN 'secondary_email'
                     ELSE 'manual'
                   END
                 ) AS m
            FROM devpost_participants dp
            LEFT JOIN users u ON u.id = dp.user_id
           WHERE dp.repo_id = qe.repo_id
          UNION ALL
          -- A submission without a Devpost identity is an operator-added row.
          SELECT jsonb_build_object(
                   'userId', u.id, 'email', u.email, 'name', u.name, 'surname', u.surname,
                   'source', 'manual', 'matchType', 'manual'
                 ) AS m
            FROM submissions s
            JOIN users u ON u.id = s.user_id
           WHERE s.repo_id = qe.repo_id
             AND s.status = 'active'
             AND NOT EXISTS (
               SELECT 1 FROM devpost_participants dp
                WHERE dp.repo_id = s.repo_id AND dp.user_id = s.user_id
             )
        ) all_members
    ),
    '[]'::jsonb
  ) AS repo_members`;

/** H40: counts by status for the challenge progress panel. */
export async function challengeProgress(challengeId: number) {
  const { rows } = await pool.query(
    `SELECT status, COUNT(*)::int AS count FROM queue_entries WHERE challenge_id = $1 GROUP BY status`,
    [challengeId],
  );
  const counts: Record<string, number> = {};
  for (const r of rows as { status: string; count: number }[]) counts[r.status] = r.count;
  const known = ["waiting", "called", "in_room", "presenting", "completed", "disqualified"];
  const other = Object.entries(counts).reduce(
    (acc, [k, v]) => (known.includes(k) ? acc : acc + v),
    0,
  );

  // Shared across every room judging this challenge (multi-room challenges
  // share one logical queue), so this is a challenge-wide average, not per-room.
  const { rows: avgRows } = await pool.query(
    `SELECT AVG(EXTRACT(EPOCH FROM (completed_at - presentation_started_at)) / 60) AS avg_minutes
       FROM queue_entries
      WHERE challenge_id = $1 AND status = 'completed'
        AND completed_at IS NOT NULL AND presentation_started_at IS NOT NULL`,
    [challengeId],
  );
  const avgEvaluationMinutes =
    avgRows[0].avg_minutes != null ? Number(avgRows[0].avg_minutes) : null;

  return {
    challengeId,
    waiting: counts.waiting ?? 0,
    called: counts.called ?? 0,
    inProgress: (counts.in_room ?? 0) + (counts.presenting ?? 0),
    evaluated: counts.completed ?? 0,
    disqualified: counts.disqualified ?? 0,
    other,
    byStatus: counts,
    avgEvaluationMinutes,
  };
}

/**
 * H41: per-room presenting/called/next — feeds both the operator panel and
 * the TV. `includeCrossRoomSkips` (H203) is opt-in and only ever passed by
 * the authenticated operator/judge route: it names other teams and rooms, so
 * it must never reach the public, unauthenticated TV feed.
 */
export async function roomView(roomId: number, opts: { includeCrossRoomSkips?: boolean } = {}) {
  const room = (await pool.query(`SELECT * FROM rooms WHERE id = $1`, [roomId])).rows[0];
  if (!room) throw new NotFoundError("Room not found", { roomId });
  const state = (await pool.query(`SELECT * FROM room_queue_state WHERE room_id = $1`, [roomId]))
    .rows[0];

  const active =
    (
      await pool.query(
        `SELECT ${QUEUE_ENTRY_SELECT}
         FROM queue_entries qe JOIN repos r ON r.id = qe.repo_id
        WHERE qe.assigned_room_id = $1 AND qe.status IN ('in_room', 'presenting')
        LIMIT 1`,
        [roomId],
      )
    ).rows[0] ?? null;

  const called = (
    await pool.query(
      `SELECT ${QUEUE_ENTRY_SELECT}
         FROM queue_entries qe JOIN repos r ON r.id = qe.repo_id
        WHERE qe.assigned_room_id = $1 AND qe.status = 'called'
        ORDER BY qe.called_at ASC NULLS LAST, qe.id ASC`,
      [roomId],
    )
  ).rows;

  const challengeIds = (
    await pool.query(`SELECT challenge_id FROM room_challenges WHERE room_id = $1`, [roomId])
  ).rows.map((r: { challenge_id: number }) => r.challenge_id);

  // H29/H46: a room judges a single challenge (many rooms may share one). The
  // judging panel renders it as a read-only label, so expose it directly.
  // H41: the TV shows the sponsoring enterprise above the challenge title.
  const challenge =
    (
      await pool.query(
        `SELECT rc.challenge_id AS id, c.title, e.name AS enterprise_name
           FROM room_challenges rc
           JOIN challenges c ON c.id = rc.challenge_id
           JOIN sponsors s ON s.id = c.author
           JOIN enterprises e ON e.id = s.enterprise_id
          WHERE rc.room_id = $1
          ORDER BY rc.assigned_at ASC, rc.challenge_id ASC
          LIMIT 1`,
        [roomId],
      )
    ).rows[0] ?? null;

  // The whole challenge queue — the operator/judge panel shows every upcoming
  // team, not just the head (the waiting-area top-up is bounded separately by
  // max_in_waiting_area in the pump).
  const next = challengeIds.length
    ? await withEtaMinutes(
        (
          await pool.query(
            `SELECT ${QUEUE_ENTRY_SELECT}
               FROM queue_entries qe JOIN repos r ON r.id = qe.repo_id
              WHERE qe.challenge_id = ANY($1) AND qe.status = 'waiting'
              ORDER BY qe.position ASC NULLS LAST, qe.id ASC`,
            [challengeIds],
          )
        ).rows,
      )
    : [];

  // H30/H203: read-only projection of the same cross-room busy-member guard
  // callNextForRoom enforces (guard.ts) — explains, without mutating
  // anything, why a waiting team at the top of the queue was not (yet)
  // called into THIS room. Recomputed on every read, so it clears the moment
  // the blocking member's other entry leaves called/in_room/presenting.
  const crossRoomSkips = opts.includeCrossRoomSkips
    ? await crossRoomSkipReasons(
        roomId,
        next as { id: number; repo_id: number; position: number | null }[],
      )
    : [];

  return { room, state, challenge, active, called, next, crossRoomSkips };
}

/**
 * For each given waiting entry, reports the OTHER live queue_entries row
 * (called/in_room/presenting) that shares a team member and is therefore
 * blocking call_next from selecting it (H30). Mirrors
 * `isRepoBlockedByBusyMember` (guard.ts) exactly, minus the advisory lock —
 * this is informational only, never used to decide a transition. Exposes
 * just enough context to explain the skip (blocking room + team name)
 * without leaking which specific member is shared.
 */
async function crossRoomSkipReasons(
  roomId: number,
  entries: { id: number; repo_id: number; position: number | null }[],
): Promise<
  {
    entryId: number;
    position: number | null;
    blockingRoomId: number;
    blockingRoomName: string;
    blockingTeamName: string;
    blockingStatus: string;
    positionPreserved: true;
  }[]
> {
  if (entries.length === 0) return [];
  const { rows } = await pool.query(
    `WITH repo_members AS (${REPO_MEMBER_RELATION_SQL})
     SELECT DISTINCT ON (qe.id)
            qe.id AS entry_id,
            br.id AS blocking_room_id, br.name AS blocking_room_name,
            bqe.status AS blocking_status, brepo.name AS blocking_team_name
       FROM queue_entries qe
       JOIN repo_members s1 ON s1.repo_id = qe.repo_id
       JOIN repo_members s2 ON s2.user_id = s1.user_id
       JOIN queue_entries bqe ON bqe.repo_id = s2.repo_id
                              AND bqe.status IN ('called', 'in_room', 'presenting')
                              AND bqe.assigned_room_id IS DISTINCT FROM $2::int
       JOIN rooms br ON br.id = bqe.assigned_room_id
       JOIN repos brepo ON brepo.id = bqe.repo_id
      WHERE qe.id = ANY($1)
      ORDER BY qe.id, bqe.id`,
    [entries.map((e) => e.id), roomId],
  );
  const byEntryId = new Map(
    (
      rows as {
        entry_id: number;
        blocking_room_id: number;
        blocking_room_name: string;
        blocking_status: string;
        blocking_team_name: string;
      }[]
    ).map((r) => [r.entry_id, r]),
  );
  return entries
    .filter((e) => byEntryId.has(e.id))
    .map((e) => {
      const r = byEntryId.get(e.id)!;
      return {
        entryId: e.id,
        position: e.position,
        blockingRoomId: r.blocking_room_id,
        blockingRoomName: r.blocking_room_name,
        blockingTeamName: r.blocking_team_name,
        blockingStatus: r.blocking_status,
        // H30 guarantee: a skip never reorders the queue, only call_next does.
        positionPreserved: true,
      };
    });
}

/** H46 read surface: current room -> challenge and room -> judge assignments. */
export async function roomAssignments(roomId: number) {
  const room = (await pool.query(`SELECT * FROM rooms WHERE id = $1`, [roomId])).rows[0];
  if (!room) throw new NotFoundError("Room not found", { roomId });

  const challengeAssignments = await pool.query(
    `SELECT rc.challenge_id, c.title, c.visibility, rc.assigned_at, rc.assigned_by,
            u.name AS assigned_by_name, u.surname AS assigned_by_surname, u.email AS assigned_by_email
       FROM room_challenges rc
       JOIN challenges c ON c.id = rc.challenge_id
       LEFT JOIN users u ON u.id = rc.assigned_by
      WHERE rc.room_id = $1
      ORDER BY c.title ASC, rc.assigned_at ASC`,
    [roomId],
  );

  // Judges are rostered per enterprise, not per room: whoever judges for the
  // enterprise that authored the room's challenge judges in this room. Read-only
  // here — the roster is managed on the enterprise (`/api/enterprises/:id/judges`).
  const judgeAssignments = await pool.query(
    `SELECT rc.challenge_id, c.title, ej.user_id, u.name, u.surname, u.email,
            ej.added_at AS assigned_at, ej.added_by AS assigned_by,
            author.enterprise_id,
            a.name AS assigned_by_name, a.surname AS assigned_by_surname, a.email AS assigned_by_email
       FROM room_challenges rc
       JOIN challenges c ON c.id = rc.challenge_id
       JOIN sponsors author ON author.id = c.author
       JOIN enterprise_judges ej ON ej.enterprise_id = author.enterprise_id
       JOIN users u ON u.id = ej.user_id
       LEFT JOIN users a ON a.id = ej.added_by
      WHERE rc.room_id = $1
      ORDER BY c.title ASC, u.name ASC NULLS LAST, u.surname ASC NULLS LAST, u.email ASC`,
    [roomId],
  );

  return {
    roomId,
    room,
    challenges: challengeAssignments.rows,
    judges: judgeAssignments.rows,
  };
}

export async function allRoomViews() {
  const rooms = (await pool.query(`SELECT id FROM rooms ORDER BY id ASC`)).rows;
  return Promise.all(rooms.map((r: { id: number }) => roomView(r.id)));
}

/**
 * Public TV snapshot (H41). The operational room projection intentionally
 * includes team membership, project links and cross-room diagnostics; venue
 * screens need only the room, challenge and visible team labels. Keep this
 * separately mapped so a new operational field cannot leak by accident.
 */
export async function publicRoomViews() {
  const views = await allRoomViews();
  const entry = (value: Record<string, unknown> | null) =>
    value
      ? {
          id: value.id,
          status: value.status,
          repo_id: value.repo_id,
          repo_name: value.repo_name,
          position: value.position,
          called_at: value.called_at,
          eta_minutes: value.eta_minutes,
        }
      : null;
  return views.map((view) => ({
    room: {
      id: view.room.id,
      name: view.room.name,
      location: view.room.location ?? null,
    },
    state: { is_paused: view.state?.is_paused ?? true },
    challenge: view.challenge
      ? {
          id: view.challenge.id,
          title: view.challenge.title,
          enterprise_name: view.challenge.enterprise_name,
        }
      : null,
    active: entry(view.active),
    called: view.called.map((value: Record<string, unknown>) => entry(value)),
    next: view.next.map((value: Record<string, unknown>) => entry(value)),
    // Preserve the public contract without exposing the operational reasons.
    crossRoomSkips: [],
  }));
}

export async function challengeEtaMinutesPerSlot(challengeId: number): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COALESCE(AVG(rqs.desired_minutes_per_team), 8) AS avg, COUNT(*)::int AS rooms
       FROM room_challenges rc
       JOIN room_queue_state rqs ON rqs.room_id = rc.room_id
      WHERE rc.challenge_id = $1`,
    [challengeId],
  );
  const avg = Number(rows[0].avg);
  const roomCount = Math.max(1, Number(rows[0].rooms));
  return avg / roomCount;
}

/** Same ETA formula as myQueueStatus (H38), applied to an arbitrary set of waiting entries. */
async function withEtaMinutes<T extends { challenge_id: number; position: number | null }>(
  entries: T[],
): Promise<(T & { eta_minutes: number | null })[]> {
  const perSlotByChallengeId = new Map<number, number>();
  for (const entry of entries) {
    if (!perSlotByChallengeId.has(entry.challenge_id)) {
      perSlotByChallengeId.set(
        entry.challenge_id,
        await challengeEtaMinutesPerSlot(entry.challenge_id),
      );
    }
  }
  return entries.map((entry) => ({
    ...entry,
    eta_minutes:
      entry.position != null
        ? Math.round(entry.position * (perSlotByChallengeId.get(entry.challenge_id) ?? 8))
        : null,
  }));
}

/**
 * H55/nav: cheap existence check backing the "My queue" nav item — same repo
 * resolution and status filter as {@link myQueueStatus}, without the join.
 */
export async function hasMyQueueItems(userId: number): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM queue_entries qe
        WHERE qe.status NOT IN ('cancelled', 'disqualified')
          AND qe.repo_id IN (
            SELECT repo_id FROM submissions WHERE user_id = $1 AND status = 'active'
            UNION
            SELECT repo_id FROM devpost_participants WHERE user_id = $1
            UNION
            SELECT dp.repo_id
              FROM devpost_participants dp
              JOIN users u ON u.id = $1
             WHERE lower(dp.email) = lower(u.email)
                OR (u.secondary_email_verified_at IS NOT NULL
                    AND lower(dp.email) = lower(u.secondary_email))
          )
     ) AS exists`,
    [userId],
  );
  return rows[0].exists as boolean;
}

/** H38: for each repo the user is in, their status/position/ETA in that challenge's queue. */
export async function myQueueStatus(userId: number) {
  const repoIds = (
    await pool.query(
      `SELECT repo_id FROM submissions WHERE user_id = $1 AND status = 'active'
       UNION
       SELECT repo_id FROM devpost_participants WHERE user_id = $1
       UNION
       SELECT dp.repo_id
         FROM devpost_participants dp
         JOIN users u ON u.id = $1
        WHERE lower(dp.email) = lower(u.email)
           OR (u.secondary_email_verified_at IS NOT NULL
               AND lower(dp.email) = lower(u.secondary_email))`,
      [userId],
    )
  ).rows.map((r: { repo_id: number }) => r.repo_id);
  if (repoIds.length === 0) return [];

  // H38: participants need to know WHERE to go. `called_room` is the concrete
  // room the entry was actually assigned to (post call_next/manual_call).
  // `possible_rooms` is every room currently judging this challenge
  // (room_challenges) — for a multi-room challenge that's the full set a
  // waiting team could be called to; once called, the frontend shows only
  // `called_room` instead.
  const { rows: entries } = await pool.query(
    `SELECT qe.*, c.title AS challenge_title, r.name AS repo_name,
            ar.id AS called_room_id, ar.name AS called_room_name, ar.location AS called_room_location,
            COALESCE(
              (SELECT jsonb_agg(
                        jsonb_build_object('id', rm.id, 'name', rm.name, 'location', rm.location)
                        ORDER BY rm.name ASC
                      )
                 FROM room_challenges rc
                 JOIN rooms rm ON rm.id = rc.room_id
                WHERE rc.challenge_id = qe.challenge_id),
              '[]'::jsonb
            ) AS possible_rooms
       FROM queue_entries qe
      JOIN challenges c ON c.id = qe.challenge_id
      JOIN repos r ON r.id = qe.repo_id
      LEFT JOIN rooms ar ON ar.id = qe.assigned_room_id
      WHERE qe.repo_id = ANY($1)
        AND qe.status NOT IN ('cancelled', 'disqualified')
      ORDER BY r.name ASC, c.title ASC, qe.id ASC`,
    [repoIds],
  );

  const results = [];
  for (const e of entries as {
    id: number;
    challenge_id: number;
    challenge_title: string;
    repo_id: number;
    repo_name: string;
    status: string;
    position: number | null;
    called_at: string | null;
    called_room_id: number | null;
    called_room_name: string | null;
    called_room_location: string | null;
    possible_rooms: { id: number; name: string; location: string | null }[];
  }[]) {
    let position: number | null = null;
    let etaMinutes: number | null = null;
    if (e.status === "waiting") {
      const { rows: aheadRows } = await pool.query(
        `SELECT COUNT(*)::int AS ahead FROM queue_entries
          WHERE challenge_id = $1 AND status = 'waiting'
            AND (position < $2 OR (position = $2 AND id < $3))`,
        [e.challenge_id, e.position, e.id],
      );
      const rank: number = Number(aheadRows[0].ahead) + 1;
      position = rank;
      const perSlot = await challengeEtaMinutesPerSlot(e.challenge_id);
      etaMinutes = Math.round(rank * perSlot);
    }
    results.push({
      entryId: e.id,
      challengeId: e.challenge_id,
      challengeTitle: e.challenge_title,
      repoId: e.repo_id,
      repoName: e.repo_name,
      status: e.status,
      position,
      etaMinutes,
      calledAt: e.called_at,
      // Concrete room once called; null while still waiting.
      room: e.called_room_id
        ? { id: e.called_room_id, name: e.called_room_name, location: e.called_room_location }
        : null,
      // Every room that could judge this challenge (multi-room challenges
      // share one logical queue across several rooms) — the frontend shows
      // this list while waiting and switches to `room` once called.
      rooms: e.possible_rooms,
    });
  }
  return results;
}

/**
 * H39: desired minutes/team vs remaining schedule time vs pending count.
 *
 * The hard ceiling on time/team is the challenge's own
 * `max_presentation_seconds` — the operator's desired pace can never exceed
 * it. That ceiling itself gets squeezed further when the remaining judging
 * window can't fit every pending team, accounting for every room sharing
 * this challenge's queue (they work the queue in parallel, so N rooms means
 * N× the throughput for the same remaining time).
 */
export async function roomPace(roomId: number) {
  const state = (await pool.query(`SELECT * FROM room_queue_state WHERE room_id = $1`, [roomId]))
    .rows[0];
  if (!state) throw new NotFoundError("Room not found", { roomId });
  const settings = (await pool.query(`SELECT * FROM queue_settings WHERE id = 1`)).rows[0];

  // H29/H46: a room judges a single challenge — same "first assigned" pick
  // roomView uses for its read-only challenge label.
  const primaryChallenge = (
    await pool.query(
      `SELECT rc.challenge_id AS id, c.max_presentation_seconds
         FROM room_challenges rc
         JOIN challenges c ON c.id = rc.challenge_id
        WHERE rc.room_id = $1
        ORDER BY rc.assigned_at ASC, rc.challenge_id ASC
        LIMIT 1`,
      [roomId],
    )
  ).rows[0] as { id: number; max_presentation_seconds: number | null } | undefined;

  const challengeIds = (
    await pool.query(`SELECT challenge_id FROM room_challenges WHERE room_id = $1`, [roomId])
  ).rows.map((r: { challenge_id: number }) => r.challenge_id);

  const pendingCount = challengeIds.length
    ? (
        await pool.query(
          `SELECT COUNT(*)::int AS n FROM queue_entries
            WHERE challenge_id = ANY($1) AND status IN ('waiting', 'called')`,
          [challengeIds],
        )
      ).rows[0].n
    : 0;

  // Every room (across the whole event) judging the same challenge splits
  // the pending teams between them — more rooms means more time/team fits
  // in the same remaining window.
  const roomCount = primaryChallenge
    ? Math.max(
        1,
        (
          await pool.query(
            `SELECT COUNT(DISTINCT room_id)::int AS n FROM room_challenges WHERE challenge_id = $1`,
            [primaryChallenge.id],
          )
        ).rows[0].n,
      )
    : 1;

  const challengeMaxMinutes = primaryChallenge?.max_presentation_seconds
    ? primaryChallenge.max_presentation_seconds / 60
    : null;
  const baselineMinutesPerTeam =
    challengeMaxMinutes != null
      ? Math.min(state.desired_minutes_per_team, challengeMaxMinutes)
      : state.desired_minutes_per_team;

  const remainingMinutes = settings.schedule_end_at
    ? Math.max(0, (new Date(settings.schedule_end_at).getTime() - Date.now()) / 60_000)
    : null;
  const requiredMinutes = (pendingCount / roomCount) * baselineMinutesPerTeam;
  const insufficientTime = remainingMinutes !== null && requiredMinutes > remainingMinutes;
  const suggestedMinutesPerTeam =
    remainingMinutes !== null && pendingCount > 0
      ? (remainingMinutes * roomCount) / pendingCount
      : null;

  // H39: honour the judging end time. When the desired pace won't fit every
  // pending team before schedule_end_at, the effective time per team is
  // squeezed down to what does fit — so judging finishes on time. Never
  // stretches beyond the challenge-capped baseline pace.
  //
  // This is ADVISORY ONLY: `effectiveMinutesPerTeam` is the target the judge's
  // timer counts down from. Going over it never auto-closes or force-ends an
  // evaluation — the frontend just recolours the timer as an over-time cue.
  // Nothing server-side ends a judging session on a clock.
  const autoAdjusted = insufficientTime && suggestedMinutesPerTeam !== null;
  const effectiveMinutesPerTeam = autoAdjusted
    ? Math.min(baselineMinutesPerTeam, suggestedMinutesPerTeam as number)
    : baselineMinutesPerTeam;

  return {
    roomId,
    desiredMinutesPerTeam: state.desired_minutes_per_team,
    challengeMaxMinutes,
    roomCount,
    pendingCount,
    remainingMinutes,
    requiredMinutes,
    insufficientTime,
    suggestedMinutesPerTeam,
    effectiveMinutesPerTeam,
    autoAdjusted,
    // H34/H203: operator-configured called-too-long warning threshold,
    // replacing the frontend's temporary max(10, 2x desired) fallback.
    calledTooLongThresholdMinutes: settings.called_too_long_threshold_minutes,
  };
}

/**
 * Every challenge queue this repo is (or was) part of — a project can submit
 * to several challenges, each with its own `queue_entries` row, so the
 * judging card's "current challenge" label understates it. Cancelled entries
 * are excluded (never actually queued); disqualified/completed ones stay so
 * the judge sees the project's full standing across challenges.
 */
export async function repoChallenges(repoId: number) {
  const { rows } = await pool.query(
    `SELECT qe.challenge_id AS id, c.title, qe.status,
            qe.assigned_room_id AS room_id, r.name AS room_name,
            COALESCE(
              (SELECT jsonb_agg(jsonb_build_object('id', rm.id, 'name', rm.name) ORDER BY rm.name ASC)
                 FROM room_challenges rc
                 JOIN rooms rm ON rm.id = rc.room_id
                WHERE rc.challenge_id = qe.challenge_id),
              '[]'::jsonb
            ) AS judging_rooms
       FROM queue_entries qe
       JOIN challenges c ON c.id = qe.challenge_id
       LEFT JOIN rooms r ON r.id = qe.assigned_room_id
      WHERE qe.repo_id = $1 AND qe.status != 'cancelled'
      ORDER BY c.title ASC`,
    [repoId],
  );
  return rows;
}

export async function entryHistory(entryId: number) {
  const { rows } = await pool.query(
    `SELECT h.*, u.name AS actor_name, u.surname AS actor_surname
       FROM queue_history h
       LEFT JOIN users u ON u.id = h.actor_id
      WHERE h.queue_entry_id = $1
      ORDER BY h.created_at ASC`,
    [entryId],
  );
  return rows;
}
