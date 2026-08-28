import { pool } from "../../db/pool.js";
import { NotFoundError } from "../../lib/errors.js";
import { queueFixtureMarker } from "./broadcast.js";
import { assertQueueChallengeReadScope, assertQueueEntryScope } from "./fixture-scope.js";
import {
  CHALLENGE_ROOM_IDS_FOR_MARKER_SQL,
  CHALLENGE_ROOM_IDS_SQL,
  QUEUE_GROUP_LABEL_JOIN,
  QUEUE_GROUP_LABEL_SQL,
  roomChallengeIds,
} from "./groups.js";
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
             AND (u.id IS NULL OR (u.account_state = 'active' AND u.anonymized_at IS NULL AND u.is_test_account = false))
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
             AND u.account_state = 'active' AND u.anonymized_at IS NULL
             AND u.is_test_account = false
             AND NOT EXISTS (
               SELECT 1 FROM devpost_participants dp
                WHERE dp.repo_id = s.repo_id AND dp.user_id = s.user_id
             )
        ) all_members
    ),
    '[]'::jsonb
  ) AS repo_members`;

/**
 * The read-only label a room's queue carries (H29/H41/H46): the queue_group's
 * enterprise, plus the group's name. The name is always `display_name` — a
 * solo group's follows its challenge's title (0412), so a 1:1 group still
 * shows the challenge title and a merged one shows the admin-chosen name of
 * the shared queue. `id` stays a member challenge id the judging panel and TV
 * already key off; `judging_panel_criteria` is the single form every team in
 * this queue is scored with, which for a merged group is the group's own.
 */
async function roomQueueLabel(roomId: number) {
  const { rows } = await pool.query(
    `SELECT c.id, c.title, qg.id AS queue_group_id, qg.display_name,
            e.name AS enterprise_name,
            COALESCE(qg.judging_panel_criteria, c.judging_panel_criteria) AS judging_panel_criteria,
            (SELECT COUNT(*)::int FROM queue_group_challenges q
              WHERE q.queue_group_id = qg.id) AS challenge_count
       FROM room_queue_groups rqg
       JOIN queue_groups qg ON qg.id = rqg.queue_group_id
       JOIN enterprises e ON e.id = qg.enterprise_id
       LEFT JOIN LATERAL (
         SELECT ch.id, ch.title, ch.judging_panel_criteria
           FROM queue_group_challenges qgc
           JOIN challenges ch ON ch.id = qgc.challenge_id AND ch.is_test_account = false
          WHERE qgc.queue_group_id = qg.id
          ORDER BY ch.id ASC
          LIMIT 1
       ) c ON true
      WHERE rqg.room_id = $1
        AND NOT EXISTS (
          SELECT 1
            FROM queue_group_challenges hidden_qgc
            JOIN challenges hidden_c ON hidden_c.id = hidden_qgc.challenge_id
           WHERE hidden_qgc.queue_group_id = qg.id
             AND hidden_c.is_test_account = true
        )
      LIMIT 1`,
    [roomId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id === null ? null : Number(row.id),
    title: row.display_name,
    enterprise_name: row.enterprise_name,
    queue_group_id: Number(row.queue_group_id),
    queue_group_name: row.display_name,
    challenge_count: Number(row.challenge_count),
    judging_panel_criteria: Array.isArray(row.judging_panel_criteria)
      ? row.judging_panel_criteria
      : null,
  };
}

/**
 * The visible/callable waiting queue for a set of challenges sharing one
 * queue_group, ordered by the single group-wide ordering key space.
 *
 * H46 "call once" (§8 Q1): a repo that applied to several of the group's
 * challenges is ONE line item, at its best position, carrying every
 * challenge id it is queued for. `queue_entries` still holds one row per
 * (challenge, repo) — the merge is purely at this read layer, so
 * `UNIQUE(challenge_id, repo_id)` and every per-challenge invariant are
 * untouched. `DISTINCT ON` is a no-op for a 1:1 group (one challenge cannot
 * yield two rows for one repo), so today's output is byte-identical.
 */
async function waitingQueueView(challengeIds: number[]) {
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (qe.repo_id) ${QUEUE_ENTRY_SELECT},
              (SELECT COALESCE(jsonb_agg(DISTINCT o.challenge_id), '[]'::jsonb)
                 FROM queue_entries o
                WHERE o.repo_id = qe.repo_id
                  AND o.challenge_id = ANY($1)
                  AND o.status = 'waiting') AS queued_challenge_ids
         FROM queue_entries qe JOIN repos r ON r.id = qe.repo_id AND r.is_test_account = false
        WHERE qe.challenge_id = ANY($1) AND qe.status = 'waiting'
          -- Same filter callNextForRoom applies: a team already called or
          -- judged for another of the group's challenges is done with the
          -- group, so it is no longer a waiting line item. Never matches for
          -- a 1:1 group.
          AND NOT EXISTS (
            SELECT 1 FROM queue_entries sib
             WHERE sib.repo_id = qe.repo_id
               AND sib.challenge_id = ANY($1)
               AND sib.id <> qe.id
               AND sib.status IN ('called', 'in_room', 'presenting', 'completed')
          )
        ORDER BY qe.repo_id, qe.position ASC NULLS LAST, qe.id ASC
     ) merged
      ORDER BY merged.position ASC NULLS LAST, merged.id ASC`,
    [challengeIds],
  );
  return rows;
}

/**
 * The whole of one queue, as a queue: every team in it, in order, with the
 * position and status each currently holds (H46). This is the queue-keyed
 * read behind the queue-management view — `roomView` answers "what is
 * happening in this room", which cannot show a queue that no room serves yet,
 * and shows a queue served by two rooms twice.
 *
 * Deduped per repo exactly as the callable queue is: a team queued for
 * several of a shared queue's challenges is ONE line, at its best position,
 * naming every challenge it is in.
 */
export async function queueGroupQueue(queueGroupId: number, fixtureMarker = false) {
  const group = (
    await pool.query(
      `SELECT qg.id, qg.display_name, qg.enterprise_id, e.name AS enterprise_name
         FROM queue_groups qg
         JOIN enterprises e ON e.id = qg.enterprise_id
        WHERE qg.id = $1
          AND NOT EXISTS (
            SELECT 1
              FROM queue_group_challenges hidden_qgc
              JOIN challenges hidden_c ON hidden_c.id = hidden_qgc.challenge_id
             WHERE hidden_qgc.queue_group_id = qg.id
               AND hidden_c.is_test_account = NOT $2::boolean
          )`,
      [queueGroupId, fixtureMarker],
    )
  ).rows[0];
  if (!group) throw new NotFoundError("Queue group not found", { queueGroupId });

  const { rows: challenges } = await pool.query(
    `SELECT c.id, c.title
       FROM queue_group_challenges qgc
       JOIN challenges c ON c.id = qgc.challenge_id
      WHERE qgc.queue_group_id = $1 AND c.is_test_account = $2
      ORDER BY c.id ASC`,
    [queueGroupId, fixtureMarker],
  );
  const challengeIds = challenges.map((c: { id: number }) => Number(c.id));
  if (challengeIds.length === 0) {
    return { group, challenges, entries: [] };
  }

  // One line per team. The chosen row is the one furthest through the queue
  // (presenting > in_room > called > waiting > done), then the best position —
  // so a team already in a room shows as in that room, not as still waiting
  // for the group's other challenge.
  const { rows: entries } = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (qe.repo_id)
              qe.id, qe.repo_id, qe.challenge_id, qe.status, qe.position,
              qe.called_at, qe.assigned_room_id,
              r.name AS repo_name,
              rm.name AS room_name,
              c.title AS challenge_title,
              (SELECT COALESCE(jsonb_agg(DISTINCT o.challenge_id), '[]'::jsonb)
                 FROM queue_entries o
                WHERE o.repo_id = qe.repo_id AND o.challenge_id = ANY($1)) AS queued_challenge_ids,
              (ar.attempt_id IS NOT NULL) AS has_review,
              ar.status AS review_status
         FROM queue_entries qe
         JOIN repos r ON r.id = qe.repo_id AND r.is_test_account = $2
         JOIN challenges c ON c.id = qe.challenge_id AND c.is_test_account = $2
         LEFT JOIN rooms rm ON rm.id = qe.assigned_room_id
         LEFT JOIN attempt_review ar ON ar.attempt_id = qe.id
        WHERE qe.challenge_id = ANY($1)
          AND qe.status NOT IN ('cancelled', 'disqualified')
        ORDER BY qe.repo_id,
                 CASE qe.status
                   WHEN 'presenting' THEN 0 WHEN 'in_room' THEN 1 WHEN 'called' THEN 2
                   WHEN 'waiting' THEN 3 ELSE 4 END,
                 qe.position ASC NULLS LAST, qe.id ASC
     ) merged
      ORDER BY CASE merged.status
                 WHEN 'presenting' THEN 0 WHEN 'in_room' THEN 1 WHEN 'called' THEN 2
                 WHEN 'waiting' THEN 3 ELSE 4 END,
               merged.position ASC NULLS LAST, merged.id ASC`,
    [challengeIds, fixtureMarker],
  );

  return { group, challenges, entries };
}

/** H40: counts by status for the challenge progress panel. */
export async function challengeProgress(challengeId: number, fixtureMarker: boolean) {
  await assertQueueChallengeReadScope(pool, challengeId, fixtureMarker);
  const { rows } = await pool.query(
    `SELECT qe.status, COUNT(*)::int AS count
       FROM queue_entries qe
       JOIN repos r ON r.id = qe.repo_id AND r.is_test_account = $2
       JOIN challenges c ON c.id = qe.challenge_id AND c.is_test_account = $2
      WHERE qe.challenge_id = $1
      GROUP BY qe.status`,
    [challengeId, fixtureMarker],
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
    `SELECT AVG(EXTRACT(EPOCH FROM (qe.completed_at - qe.presentation_started_at)) / 60) AS avg_minutes
       FROM queue_entries qe
       JOIN repos r ON r.id = qe.repo_id AND r.is_test_account = $2
       JOIN challenges c ON c.id = qe.challenge_id AND c.is_test_account = $2
      WHERE qe.challenge_id = $1 AND qe.status = 'completed'
        AND qe.completed_at IS NOT NULL AND qe.presentation_started_at IS NOT NULL`,
    [challengeId, fixtureMarker],
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
         FROM queue_entries qe
         JOIN repos r ON r.id = qe.repo_id AND r.is_test_account = false
         JOIN challenges c ON c.id = qe.challenge_id AND c.is_test_account = false
         JOIN queue_group_challenges qgc ON qgc.challenge_id = qe.challenge_id
         JOIN room_queue_groups rqg
           ON rqg.room_id = qe.assigned_room_id
          AND rqg.queue_group_id = qgc.queue_group_id
        WHERE qe.assigned_room_id = $1 AND qe.status IN ('in_room', 'presenting')
        LIMIT 1`,
        [roomId],
      )
    ).rows[0] ?? null;

  const called = (
    await pool.query(
      `SELECT ${QUEUE_ENTRY_SELECT}
         FROM queue_entries qe
         JOIN repos r ON r.id = qe.repo_id AND r.is_test_account = false
         JOIN challenges c ON c.id = qe.challenge_id AND c.is_test_account = false
         JOIN queue_group_challenges qgc ON qgc.challenge_id = qe.challenge_id
         JOIN room_queue_groups rqg
           ON rqg.room_id = qe.assigned_room_id
          AND rqg.queue_group_id = qgc.queue_group_id
        WHERE qe.assigned_room_id = $1 AND qe.status = 'called'
        ORDER BY qe.called_at ASC NULLS LAST, qe.id ASC`,
      [roomId],
    )
  ).rows;

  const challengeIds = await roomChallengeIds(pool, roomId);

  // H29/H46: a room serves one queue_group. The judging panel renders it as a
  // read-only label, so expose it directly. A 1:1 group (every group today)
  // labels itself with its challenge's own title; a merged group uses the
  // admin-chosen group name, which is what the shared queue is called.
  // H41: the TV shows the sponsoring enterprise above that title.
  const challenge = await roomQueueLabel(roomId);

  // The whole group queue — the operator/judge panel shows every upcoming
  // team, not just the head (the waiting-area top-up is bounded separately by
  // max_in_waiting_area in the pump).
  const next = challengeIds.length
    ? await withEtaMinutes(await waitingQueueView(challengeIds))
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

/** H46 read surface: current room -> enterprise pool, serving queue_group, and the judges that follow. */
export async function roomAssignments(roomId: number) {
  const room = (await pool.query(`SELECT * FROM rooms WHERE id = $1`, [roomId])).rows[0];
  if (!room) throw new NotFoundError("Room not found", { roomId });

  const enterprise =
    (
      await pool.query(
        `SELECT re.enterprise_id, e.name AS enterprise_name,
                re.assigned_at, re.assigned_by,
                u.name AS assigned_by_name, u.surname AS assigned_by_surname,
                u.email AS assigned_by_email
           FROM room_enterprises re
           JOIN enterprises e ON e.id = re.enterprise_id
           LEFT JOIN users u ON u.id = re.assigned_by
          WHERE re.room_id = $1`,
        [roomId],
      )
    ).rows[0] ?? null;

  const queueGroup =
    (
      await pool.query(
        `SELECT qg.id, qg.display_name, qg.enterprise_id, e.name AS enterprise_name,
                rqg.assigned_at, rqg.assigned_by,
                u.name AS assigned_by_name, u.surname AS assigned_by_surname,
                u.email AS assigned_by_email
           FROM room_queue_groups rqg
           JOIN queue_groups qg ON qg.id = rqg.queue_group_id
           JOIN enterprises e ON e.id = qg.enterprise_id
           LEFT JOIN users u ON u.id = rqg.assigned_by
          WHERE rqg.room_id = $1
            AND NOT EXISTS (
              SELECT 1
                FROM queue_group_challenges hidden_qgc
                JOIN challenges hidden_c ON hidden_c.id = hidden_qgc.challenge_id
               WHERE hidden_qgc.queue_group_id = qg.id
                 AND hidden_c.is_test_account = true
            )`,
        [roomId],
      )
    ).rows[0] ?? null;

  // Every challenge the room judges, reached through its queue_group — one
  // row for a 1:1 group, so this keeps the shape the old room_challenges read
  // returned.
  const challengeAssignments = await pool.query(
    `SELECT qgc.challenge_id, c.title, c.visibility, rqg.assigned_at, rqg.assigned_by,
            rqg.queue_group_id, qg.display_name AS queue_group_name,
            u.name AS assigned_by_name, u.surname AS assigned_by_surname, u.email AS assigned_by_email
       FROM room_queue_groups rqg
       JOIN queue_groups qg ON qg.id = rqg.queue_group_id
       JOIN queue_group_challenges qgc ON qgc.queue_group_id = rqg.queue_group_id
       JOIN challenges c ON c.id = qgc.challenge_id AND c.is_test_account = false
       LEFT JOIN users u ON u.id = rqg.assigned_by
      WHERE rqg.room_id = $1
      ORDER BY c.title ASC, qgc.challenge_id ASC`,
    [roomId],
  );

  // Judges are rostered per enterprise, not per room: whoever judges for the
  // enterprise owning the room's queue_group judges in this room. Read-only
  // here — the roster is managed on the enterprise (`/api/enterprises/:id/judges`).
  const judgeAssignments = await pool.query(
    `SELECT ej.user_id, u.name, u.surname, u.email,
            ej.added_at AS assigned_at, ej.added_by AS assigned_by,
            qg.enterprise_id, rqg.queue_group_id,
            a.name AS assigned_by_name, a.surname AS assigned_by_surname, a.email AS assigned_by_email
       FROM room_queue_groups rqg
       JOIN queue_groups qg ON qg.id = rqg.queue_group_id
       JOIN enterprise_judges ej ON ej.enterprise_id = qg.enterprise_id
       JOIN users u ON u.id = ej.user_id
          AND u.account_state = 'active' AND u.anonymized_at IS NULL
          AND u.is_test_account = false
       LEFT JOIN users a ON a.id = ej.added_by
      WHERE rqg.room_id = $1
      ORDER BY u.name ASC NULLS LAST, u.surname ASC NULLS LAST, u.email ASC`,
    [roomId],
  );

  return {
    roomId,
    room,
    enterprise,
    queueGroup,
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
  // Public TV is the real-venue projection. Synthetic and mixed room graphs
  // are omitted entirely rather than appearing as empty room shells after
  // `roomView` filters their queue contents.
  const { rows: rooms } = await pool.query<{ id: number }>(`SELECT id FROM rooms ORDER BY id ASC`);
  const realRoomIds: number[] = [];
  for (const room of rooms) {
    if ((await queueFixtureMarker(pool, "room", Number(room.id))) === false) {
      realRoomIds.push(Number(room.id));
    }
  }
  const views = await Promise.all(realRoomIds.map((roomId) => roomView(roomId)));
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
          // H46: rooms cluster on the TV by the queue they serve, which is the
          // group — two rooms working a shared queue are one card even though
          // `id` names whichever member challenge came first.
          queue_group_id: view.challenge.queue_group_id,
        }
      : null,
    active: entry(view.active),
    called: view.called.map((value: Record<string, unknown>) => entry(value)),
    next: view.next.map((value: Record<string, unknown>) => entry(value)),
    // Preserve the public contract without exposing the operational reasons.
    crossRoomSkips: [],
  }));
}

export async function challengeEtaMinutesPerSlot(
  challengeId: number,
  fixtureMarker = false,
): Promise<number> {
  const servingRoomsSql = fixtureMarker
    ? CHALLENGE_ROOM_IDS_FOR_MARKER_SQL
    : CHALLENGE_ROOM_IDS_SQL;
  const { rows } = await pool.query(
    // Every room working this challenge's queue_group shares its pace.
    `SELECT COALESCE(AVG(rqs.desired_minutes_per_team), 8) AS avg, COUNT(*)::int AS rooms
       FROM (${servingRoomsSql}) serving
       JOIN room_queue_state rqs
         ON rqs.room_id = serving.room_id
        AND rqs.is_paused = false`,
    fixtureMarker ? [challengeId, fixtureMarker] : [challengeId],
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
 * H38/H55/H54: shared participant scope for both self-queue reads. The
 * authenticated user's persisted fixture marker selects repositories and
 * challenges; a queue group is usable only when every challenge it contains
 * carries that same marker. This keeps queue ordering and room projections
 * from crossing the real/synthetic boundary even when a stale graph is mixed.
 */
const PARTICIPANT_QUEUE_SCOPE_SQL = `
WITH viewer AS (
   SELECT is_test_account
     FROM users
    WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
 ), my_repos AS (
   SELECT s.repo_id
     FROM submissions s
     JOIN users su ON su.id = s.user_id
     JOIN repos sr ON sr.id = s.repo_id
     CROSS JOIN viewer v
    WHERE s.user_id = $1 AND s.status = 'active'
      AND su.account_state = 'active' AND su.anonymized_at IS NULL
      AND su.is_test_account = v.is_test_account
      AND sr.is_test_account = v.is_test_account
   UNION
   SELECT dp.repo_id
     FROM devpost_participants dp
     JOIN users du ON du.id = dp.user_id
     JOIN repos dr ON dr.id = dp.repo_id
     CROSS JOIN viewer v
    WHERE dp.user_id = $1
      AND du.account_state = 'active' AND du.anonymized_at IS NULL
      AND du.is_test_account = v.is_test_account
      AND dr.is_test_account = v.is_test_account
   UNION
   SELECT dp.repo_id
     FROM devpost_participants dp
     JOIN users u ON u.id = $1
     JOIN repos er ON er.id = dp.repo_id
     CROSS JOIN viewer v
    WHERE u.account_state = 'active' AND u.anonymized_at IS NULL
      AND u.is_test_account = v.is_test_account
      AND er.is_test_account = v.is_test_account
      AND (lower(dp.email) = lower(u.email)
       OR (u.secondary_email_verified_at IS NOT NULL
           AND lower(dp.email) = lower(u.secondary_email)))
 ), enterprise_markers AS (
   SELECT s.enterprise_id, u.is_test_account AS marker
     FROM sponsors s
     JOIN users u ON u.id = s.user_id
   UNION ALL
   SELECT s.enterprise_id, c.is_test_account AS marker
     FROM sponsors s
     JOIN challenges c ON c.author = s.id
 ), visible_queue_groups AS (
   SELECT qgc.queue_group_id
     FROM queue_group_challenges qgc
     JOIN challenges group_challenge ON group_challenge.id = qgc.challenge_id
     JOIN queue_groups group_qg ON group_qg.id = qgc.queue_group_id
     LEFT JOIN enterprise_markers em ON em.enterprise_id = group_qg.enterprise_id
     CROSS JOIN viewer v
    GROUP BY qgc.queue_group_id, v.is_test_account
   HAVING bool_and(group_challenge.is_test_account = v.is_test_account)
      AND COUNT(em.marker) > 0
      AND bool_and(em.marker = v.is_test_account)
 ), room_markers AS (
   SELECT re.room_id, u.is_test_account AS marker
     FROM room_enterprises re
     JOIN sponsors s ON s.enterprise_id = re.enterprise_id
     JOIN users u ON u.id = s.user_id
   UNION ALL
   SELECT re.room_id, c.is_test_account AS marker
     FROM room_enterprises re
     JOIN sponsors s ON s.enterprise_id = re.enterprise_id
     JOIN challenges c ON c.author = s.id
   UNION ALL
   SELECT rqg.room_id, u.is_test_account AS marker
     FROM room_queue_groups rqg
     JOIN queue_groups qg ON qg.id = rqg.queue_group_id
     JOIN sponsors s ON s.enterprise_id = qg.enterprise_id
     JOIN users u ON u.id = s.user_id
   UNION ALL
   SELECT rqg.room_id, c.is_test_account AS marker
     FROM room_queue_groups rqg
     JOIN queue_groups qg ON qg.id = rqg.queue_group_id
     JOIN sponsors s ON s.enterprise_id = qg.enterprise_id
     JOIN challenges c ON c.author = s.id
   UNION ALL
   SELECT rqg.room_id, c.is_test_account AS marker
     FROM room_queue_groups rqg
     JOIN queue_group_challenges qgc ON qgc.queue_group_id = rqg.queue_group_id
     JOIN challenges c ON c.id = qgc.challenge_id
 UNION ALL
   -- A malformed cross-marker entry is excluded from the room marker; the
   -- entry itself is filtered below, while transition paths reject the graph.
   SELECT rqg.room_id, r.is_test_account AS marker
     FROM room_queue_groups rqg
     JOIN queue_group_challenges qgc ON qgc.queue_group_id = rqg.queue_group_id
     JOIN challenges c ON c.id = qgc.challenge_id
     JOIN queue_entries qe ON qe.challenge_id = qgc.challenge_id
     JOIN repos r ON r.id = qe.repo_id
    WHERE r.is_test_account = c.is_test_account
 ), room_scopes AS (
   SELECT r.id AS room_id,
          EXISTS (
            SELECT 1 FROM room_enterprises re WHERE re.room_id = r.id
            UNION ALL
            SELECT 1 FROM room_queue_groups rqg WHERE rqg.room_id = r.id
          ) AS has_graph,
          COUNT(rm.marker) > 0 AS has_marker,
          COALESCE(bool_or(rm.marker IS TRUE), false) AS has_synthetic,
          COALESCE(bool_or(rm.marker IS FALSE), false) AS has_real
     FROM rooms r
     LEFT JOIN room_markers rm ON rm.room_id = r.id
    GROUP BY r.id
 ), visible_rooms AS (
   SELECT rs.room_id
     FROM room_scopes rs
     CROSS JOIN viewer v
    WHERE (NOT rs.has_graph)
       OR (rs.has_marker
           AND NOT (rs.has_synthetic AND rs.has_real)
           AND rs.has_synthetic = v.is_test_account)
 )`;

/**
 * H55/nav: cheap existence check backing the "My queue" nav item — same repo
 * resolution and status filter as {@link myQueueStatus}, without the join.
 */
export async function hasMyQueueItems(userId: number): Promise<boolean> {
  const { rows } = await pool.query(
    `${PARTICIPANT_QUEUE_SCOPE_SQL}
     SELECT EXISTS (
       SELECT 1
         FROM queue_entries qe
         JOIN my_repos mr ON mr.repo_id = qe.repo_id
         JOIN repos r ON r.id = qe.repo_id
         JOIN challenges c ON c.id = qe.challenge_id
         JOIN queue_group_challenges qgc ON qgc.challenge_id = qe.challenge_id
         JOIN visible_queue_groups vq ON vq.queue_group_id = qgc.queue_group_id
         CROSS JOIN viewer v
        WHERE qe.status NOT IN ('cancelled', 'disqualified')
          AND r.is_test_account = v.is_test_account
          AND c.is_test_account = v.is_test_account
     ) AS exists`,
    [userId],
  );
  return rows[0].exists as boolean;
}

/** H38: for each repo the user is in, their status/position/ETA in that challenge's queue. */
export async function myQueueStatus(userId: number) {
  // H38: participants need to know WHERE to go. `called_room` is the concrete
  // room the entry was actually assigned to (post call_next/manual_call).
  //
  // H46: `possible_rooms` is every room serving this challenge's QUEUE_GROUP,
  // not just rooms historically tied to the challenge itself — a waiting team
  // in a shared group can be called into any of the group's rooms, which is
  // the point of the shared queue. Identical to the old room-per-challenge
  // set for every 1:1 group. Once called, the frontend shows `called_room`.
  // #544: rank and pace every relevant entry in one bounded, set-based read.
  // `repo_occurrence` lets the window count each team once across a shared
  // queue while preserving the historical rank of sibling entries.
  const { rows: entries } = await pool.query(
    `${PARTICIPANT_QUEUE_SCOPE_SQL}, my_entries AS (
       SELECT qe.id, qe.challenge_id,
              qgc.queue_group_id AS queue_key
         FROM queue_entries qe
         JOIN my_repos mr ON mr.repo_id = qe.repo_id
         JOIN repos repo ON repo.id = qe.repo_id
         JOIN challenges challenge ON challenge.id = qe.challenge_id
         JOIN queue_group_challenges qgc ON qgc.challenge_id = qe.challenge_id
         JOIN visible_queue_groups vq ON vq.queue_group_id = qgc.queue_group_id
         CROSS JOIN viewer v
        WHERE qe.status NOT IN ('cancelled', 'disqualified')
          AND repo.is_test_account = v.is_test_account
          AND challenge.is_test_account = v.is_test_account
     ), waiting_order AS (
       SELECT qe.id, qe.repo_id, qe.position,
              qgc.queue_group_id AS queue_key,
              ROW_NUMBER() OVER (
                PARTITION BY qgc.queue_group_id, qe.repo_id
                ORDER BY qe.position ASC, qe.id ASC
              ) AS repo_occurrence
         FROM queue_entries qe
         JOIN repos repo ON repo.id = qe.repo_id
         JOIN challenges challenge ON challenge.id = qe.challenge_id
         JOIN queue_group_challenges qgc ON qgc.challenge_id = qe.challenge_id
         JOIN visible_queue_groups vq ON vq.queue_group_id = qgc.queue_group_id
         CROSS JOIN viewer v
        WHERE qe.status = 'waiting'
          AND repo.is_test_account = v.is_test_account
          AND challenge.is_test_account = v.is_test_account
          AND qgc.queue_group_id IN (
            SELECT DISTINCT queue_key FROM my_entries
          )
     ), waiting_ranks AS (
       SELECT id,
              CASE WHEN position IS NULL THEN 1
                   ELSE SUM((repo_occurrence = 1)::int) OVER (
                     PARTITION BY queue_key
                     ORDER BY position ASC, id ASC
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                   ) + CASE WHEN repo_occurrence = 1 THEN 0 ELSE 1 END
              END::int AS queue_rank
         FROM waiting_order
     ), queue_pace AS (
       SELECT qgc.challenge_id,
              COALESCE(AVG(rqs.desired_minutes_per_team), 8) /
                GREATEST(1, COUNT(rqs.room_id)) AS minutes_per_slot
         FROM queue_group_challenges qgc
         JOIN visible_queue_groups vq ON vq.queue_group_id = qgc.queue_group_id
         JOIN (SELECT DISTINCT challenge_id FROM my_entries) mine
           ON mine.challenge_id = qgc.challenge_id
         LEFT JOIN room_queue_groups rqg ON rqg.queue_group_id = qgc.queue_group_id
         JOIN visible_rooms vr ON vr.room_id = rqg.room_id
         LEFT JOIN room_queue_state rqs
           ON rqs.room_id = rqg.room_id
          AND rqs.is_paused = false
        GROUP BY qgc.challenge_id
     )
     SELECT qe.*, ${QUEUE_GROUP_LABEL_SQL} AS challenge_title, r.name AS repo_name,
            ar.id AS called_room_id, ar.name AS called_room_name, ar.location AS called_room_location,
            wr.queue_rank,
            COALESCE(qp.minutes_per_slot, 8) AS minutes_per_slot,
            COALESCE(
              (SELECT jsonb_agg(
                        jsonb_build_object('id', rm.id, 'name', rm.name, 'location', rm.location)
                        ORDER BY rm.name ASC
                      )
                 FROM queue_group_challenges self
                 JOIN visible_queue_groups vq ON vq.queue_group_id = self.queue_group_id
                 JOIN room_queue_groups rqg ON rqg.queue_group_id = self.queue_group_id
                 JOIN visible_rooms vr ON vr.room_id = rqg.room_id
                 JOIN rooms rm ON rm.id = rqg.room_id
                WHERE self.challenge_id = qe.challenge_id),
              '[]'::jsonb
            ) AS possible_rooms
       FROM queue_entries qe
      JOIN challenges c ON c.id = qe.challenge_id
      ${QUEUE_GROUP_LABEL_JOIN}
      JOIN repos r ON r.id = qe.repo_id
      JOIN my_entries mine ON mine.id = qe.id
      JOIN viewer v ON v.is_test_account = r.is_test_account
      LEFT JOIN room_queue_groups called_rqg
        ON called_rqg.room_id = qe.assigned_room_id
       AND called_rqg.queue_group_id = qgc_label.queue_group_id
      LEFT JOIN visible_rooms called_vr ON called_vr.room_id = called_rqg.room_id
      LEFT JOIN rooms ar ON ar.id = called_vr.room_id
      LEFT JOIN waiting_ranks wr ON wr.id = qe.id
      LEFT JOIN queue_pace qp ON qp.challenge_id = qe.challenge_id
      WHERE qe.status NOT IN ('cancelled', 'disqualified')
        AND c.is_test_account = v.is_test_account
        AND EXISTS (
          SELECT 1 FROM visible_queue_groups vq
           WHERE vq.queue_group_id = qgc_label.queue_group_id
        )
      ORDER BY r.name ASC, challenge_title ASC, qe.id ASC`,
    [userId],
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
    queue_rank: number | null;
    minutes_per_slot: string | number;
  }[]) {
    let position: number | null = null;
    let etaMinutes: number | null = null;
    if (e.status === "waiting") {
      const rank = Number(e.queue_rank);
      position = rank;
      etaMinutes = Math.round(rank * Number(e.minutes_per_slot));
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

  // H29/H46: the presentation-length ceiling comes from the room's queue_group.
  // Every group is 1:1 today, so this is that one challenge's own ceiling; for
  // a merged group the strictest member ceiling is the one that must hold for
  // every team the group calls.
  const primaryChallenge = (
    await pool.query(
      `SELECT qgc.challenge_id::int AS id,
              c.max_presentation_seconds::int AS max_presentation_seconds
         FROM room_queue_groups rqg
         JOIN queue_group_challenges qgc ON qgc.queue_group_id = rqg.queue_group_id
         JOIN challenges c ON c.id = qgc.challenge_id AND c.is_test_account = false
         WHERE rqg.room_id = $1
         ORDER BY qgc.challenge_id ASC
         LIMIT 1`,
      [roomId],
    )
  ).rows[0] as { id: number; max_presentation_seconds: number | null } | undefined;

  const challengeIds = await roomChallengeIds(pool, roomId);

  // Distinct teams, not rows: a repo merged across two of the group's
  // challenges is one team still to be judged (the "call once" view).
  const pendingCount = challengeIds.length
    ? (
        await pool.query(
          `SELECT COUNT(DISTINCT repo_id)::int AS n FROM queue_entries
            WHERE challenge_id = ANY($1) AND status IN ('waiting', 'called')
              AND repo_id IN (SELECT id FROM repos WHERE is_test_account = false)`,
          [challengeIds],
        )
      ).rows[0].n
    : 0;

  // Every room (across the whole event) working the same queue_group splits
  // the pending teams between them — more rooms means more time/team fits
  // in the same remaining window.
  const roomCount = primaryChallenge
    ? Math.max(
        1,
        (
          await pool.query(
            `SELECT COUNT(DISTINCT serving.room_id)::int AS n
               FROM (${CHALLENGE_ROOM_IDS_SQL}) serving
               JOIN room_queue_state rqs
                 ON rqs.room_id = serving.room_id
                AND rqs.is_paused = false`,
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
    `SELECT qe.id AS entry_id, qe.repo_id, qe.challenge_id AS id, c.title, qe.status,
            qe.position, qe.called_at,
            qgc.queue_group_id, qg.display_name AS queue_name,
            qe.assigned_room_id AS room_id, r.name AS room_name,
            COALESCE(
              (SELECT jsonb_agg(jsonb_build_object('id', rm.id, 'name', rm.name) ORDER BY rm.name ASC)
                 FROM queue_group_challenges self
                 JOIN room_queue_groups rqg ON rqg.queue_group_id = self.queue_group_id
                 JOIN rooms rm ON rm.id = rqg.room_id
                WHERE self.challenge_id = qe.challenge_id),
              '[]'::jsonb
            ) AS judging_rooms
       FROM queue_entries qe
       JOIN challenges c ON c.id = qe.challenge_id AND c.is_test_account = false
       JOIN repos repo ON repo.id = qe.repo_id AND repo.is_test_account = false
       LEFT JOIN queue_group_challenges qgc ON qgc.challenge_id = qe.challenge_id
       LEFT JOIN queue_groups qg ON qg.id = qgc.queue_group_id
       LEFT JOIN rooms r ON r.id = qe.assigned_room_id
      WHERE qe.repo_id = $1 AND qe.status != 'cancelled'
      ORDER BY qg.display_name ASC NULLS LAST, c.title ASC`,
    [repoId],
  );
  return Promise.all(
    rows.map(
      async (row: {
        entry_id: number;
        repo_id: number;
        id: number;
        title: string;
        status: string;
        position: number | null;
        called_at: string | null;
      }) => ({
        ...row,
        eta_minutes:
          row.status === "waiting" && row.position != null
            ? Math.round(Number(row.position) * (await challengeEtaMinutesPerSlot(Number(row.id))))
            : null,
      }),
    ),
  );
}

export async function entryHistory(entryId: number, actorId?: number) {
  const fixtureMarker =
    actorId == null ? false : await assertQueueEntryScope(pool, actorId, entryId);
  const { rows } = await pool.query(
    `SELECT h.*, u.name AS actor_name, u.surname AS actor_surname
       FROM queue_history h
       JOIN queue_entries qe ON qe.id = h.queue_entry_id
       JOIN challenges c ON c.id = qe.challenge_id AND c.is_test_account = $2
       JOIN repos repo ON repo.id = qe.repo_id AND repo.is_test_account = $2
       LEFT JOIN users u
         ON u.id = h.actor_id
        AND u.is_test_account = $2
      WHERE h.queue_entry_id = $1
      ORDER BY h.created_at ASC`,
    [entryId, fixtureMarker],
  );
  return rows;
}
