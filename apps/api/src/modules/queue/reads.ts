import { pool } from "../../db/pool.js";
import { NotFoundError } from "../../lib/errors.js";

const QUEUE_ENTRY_SELECT = `qe.*, r.name AS repo_name, r.description AS repo_description,
  r.github_url AS repo_github_url, r.devpost_url AS repo_devpost_url, r.demo_url AS repo_demo_url,
  COALESCE(
    (
      SELECT jsonb_agg(
               jsonb_build_object(
                 'userId', u.id,
                 'email', u.email,
                 'name', u.name,
                 'surname', u.surname
               )
               ORDER BY u.name ASC NULLS LAST, u.surname ASC NULLS LAST, u.email ASC
             )
        FROM users u
        JOIN (
          SELECT user_id FROM submissions WHERE repo_id = qe.repo_id
          UNION
          SELECT user_id FROM devpost_participants
           WHERE repo_id = qe.repo_id AND user_id IS NOT NULL
          UNION
          SELECT u.id
            FROM devpost_participants dp
            JOIN users u
              ON lower(dp.email) = lower(u.email)
              OR (u.secondary_email_verified_at IS NOT NULL
                  AND lower(dp.email) = lower(u.secondary_email))
           WHERE dp.repo_id = qe.repo_id
        ) members ON members.user_id = u.id
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
  return {
    challengeId,
    waiting: counts.waiting ?? 0,
    called: counts.called ?? 0,
    inProgress: (counts.in_room ?? 0) + (counts.presenting ?? 0),
    evaluated: counts.completed ?? 0,
    disqualified: counts.disqualified ?? 0,
    other,
    byStatus: counts,
  };
}

/** H41: per-room presenting/called/next — feeds both the operator panel and the TV. */
export async function roomView(roomId: number) {
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
    ? (
        await pool.query(
          `SELECT ${QUEUE_ENTRY_SELECT}
             FROM queue_entries qe JOIN repos r ON r.id = qe.repo_id
            WHERE qe.challenge_id = ANY($1) AND qe.status = 'waiting'
            ORDER BY qe.position ASC NULLS LAST, qe.id ASC`,
          [challengeIds],
        )
      ).rows
    : [];

  return { room, state, challenge, active, called, next };
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

  const judgeAssignments = await pool.query(
    `SELECT rj.challenge_id, c.title, rj.user_id, u.name, u.surname, u.email,
            rj.assigned_at, rj.assigned_by,
            a.name AS assigned_by_name, a.surname AS assigned_by_surname, a.email AS assigned_by_email
       FROM room_judges rj
       JOIN challenges c ON c.id = rj.challenge_id
       JOIN users u ON u.id = rj.user_id
       LEFT JOIN users a ON a.id = rj.assigned_by
      WHERE rj.room_id = $1
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

async function challengeEtaMinutesPerSlot(challengeId: number): Promise<number> {
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

/** H38: for each repo the user is in, their status/position/ETA in that challenge's queue. */
export async function myQueueStatus(userId: number) {
  const repoIds = (
    await pool.query(
      `SELECT repo_id FROM submissions WHERE user_id = $1
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

  const { rows: entries } = await pool.query(
    `SELECT qe.*, c.title AS challenge_title, r.name AS repo_name
       FROM queue_entries qe
      JOIN challenges c ON c.id = qe.challenge_id
      JOIN repos r ON r.id = qe.repo_id
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
    assigned_room_id: number | null;
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
      roomId: e.assigned_room_id,
    });
  }
  return results;
}

/** H39: desired minutes/team vs remaining schedule time vs pending count. */
export async function roomPace(roomId: number) {
  const state = (await pool.query(`SELECT * FROM room_queue_state WHERE room_id = $1`, [roomId]))
    .rows[0];
  if (!state) throw new NotFoundError("Room not found", { roomId });
  const settings = (await pool.query(`SELECT * FROM queue_settings WHERE id = 1`)).rows[0];

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

  const remainingMinutes = settings.schedule_end_at
    ? Math.max(0, (new Date(settings.schedule_end_at).getTime() - Date.now()) / 60_000)
    : null;
  const requiredMinutes = pendingCount * state.desired_minutes_per_team;
  const insufficientTime = remainingMinutes !== null && requiredMinutes > remainingMinutes;
  const suggestedMinutesPerTeam =
    remainingMinutes !== null && pendingCount > 0 ? remainingMinutes / pendingCount : null;

  // H39: honour the judging end time. When the desired pace won't fit every
  // pending team before schedule_end_at, the effective time per team is
  // squeezed down to what does fit — so judging finishes on time. Never
  // stretches beyond the operator's desired pace.
  //
  // This is ADVISORY ONLY: `effectiveMinutesPerTeam` is the target the judge's
  // timer counts down from. Going over it never auto-closes or force-ends an
  // evaluation — the frontend just recolours the timer as an over-time cue.
  // Nothing server-side ends a judging session on a clock.
  const autoAdjusted = insufficientTime && suggestedMinutesPerTeam !== null;
  const effectiveMinutesPerTeam = autoAdjusted
    ? Math.min(state.desired_minutes_per_team, suggestedMinutesPerTeam as number)
    : state.desired_minutes_per_team;

  return {
    roomId,
    desiredMinutesPerTeam: state.desired_minutes_per_team,
    pendingCount,
    remainingMinutes,
    requiredMinutes,
    insufficientTime,
    suggestedMinutesPerTeam,
    effectiveMinutesPerTeam,
    autoAdjusted,
  };
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
