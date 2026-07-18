import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type { Queryable } from "../../db/pool.js";
import { broadcast } from "../../lib/sse.js";
import { notify } from "../notifications/service.js";

/**
 * Team members for a repo. `submissions` is the normal source, while the
 * Devpost fallback keeps notifications correct during or after an import even
 * if a legacy participant row has not yet gained its submission.
 */
export async function repoMemberIds(client: Queryable, repoId: number): Promise<number[]> {
  const { rows } = await client.query(
    `SELECT user_id FROM submissions WHERE repo_id = $1
     UNION
     SELECT user_id FROM devpost_participants WHERE repo_id = $1 AND user_id IS NOT NULL
     UNION
     SELECT u.id
       FROM devpost_participants dp
       JOIN users u
         ON lower(dp.email) = lower(u.email)
         OR (u.secondary_email_verified_at IS NOT NULL
             AND lower(dp.email) = lower(u.secondary_email))
      WHERE dp.repo_id = $1`,
    [repoId],
  );
  return rows.map((r: { user_id: number }) => r.user_id);
}

/**
 * H29/H38: "ve a esperar a la sala X". Goes through the generic notify()
 * module (H51/H53) so a call reaches the recipient's inbox AND every other
 * configured channel (email/push), not just push — `queue` is a mandatory
 * category so every requested channel is enqueued regardless of preference.
 * Also broadcasts on the member's personal SSE topic so an open participant
 * view updates live.
 */
export async function notifyTeamCalled(
  client: Queryable,
  params: {
    entryId: number;
    challengeId: number;
    repoId: number;
    roomId: number;
    roomName: string;
    roomLocation?: string | null;
  },
): Promise<void> {
  const memberIds = await repoMemberIds(client, params.repoId);
  if (memberIds.length === 0) return;

  const { rows: ctxRows } = await client.query(
    `SELECT c.title AS challenge_name, r.name AS team_name FROM challenges c, repos r
      WHERE c.id = $1 AND r.id = $2`,
    [params.challengeId, params.repoId],
  );
  const challengeName: string = ctxRows[0]?.challenge_name ?? "";
  const teamName: string = ctxRows[0]?.team_name ?? "";

  const { rows: userRows } = await client.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [
    memberIds,
  ]);
  const nameById = new Map<number, string | null>(
    userRows.map((u: { id: number; name: string | null }) => [u.id, u.name]),
  );

  const payload = {
    entryId: params.entryId,
    challengeId: params.challengeId,
    roomId: params.roomId,
    roomName: params.roomName,
    roomLocation: params.roomLocation ?? null,
  };
  for (const userId of memberIds) {
    await notify(client, {
      userId,
      category: "queue",
      payload: {
        ...payload,
        template: "queue.called",
        vars: {
          name: nameById.get(userId) ?? "",
          teamName,
          challengeName,
          roomName: params.roomName,
        },
      },
    });
  }
  // Broadcast after the rows are durably queued but still inside the caller's
  // transaction boundary is fine — SSE has no rollback semantics either way,
  // and callers only reach here once the domain write already validated.
  for (const userId of memberIds) {
    await broadcast(`${SSE_TOPICS.USER_PREFIX}${userId}`, EVENTS.USER_QUEUE_CALLED, payload);
  }
  // Operator-facing echo on the shared queue topic, carrying the team name so
  // the queue-ops screen can hint "team X should arrive at room Y" (opt-in).
  await broadcast(SSE_TOPICS.QUEUE, EVENTS.QUEUE_TEAM_CALLED, { ...payload, teamName });
}

/** H38 pre-aviso: estimated wait <= queue_settings.pre_call_notification_eta_minutes. */
export async function notifyTeamPreCall(
  client: Queryable,
  params: { entryId: number; challengeId: number; repoId: number; etaMinutes: number },
): Promise<void> {
  const memberIds = await repoMemberIds(client, params.repoId);
  if (memberIds.length === 0) return;

  const { rows: ctxRows } = await client.query(
    `SELECT c.title AS challenge_name, r.name AS team_name FROM challenges c, repos r
      WHERE c.id = $1 AND r.id = $2`,
    [params.challengeId, params.repoId],
  );
  const challengeName: string = ctxRows[0]?.challenge_name ?? "";
  const teamName: string = ctxRows[0]?.team_name ?? "";

  const { rows: userRows } = await client.query(`SELECT id, name FROM users WHERE id = ANY($1)`, [
    memberIds,
  ]);
  const nameById = new Map<number, string | null>(
    userRows.map((u: { id: number; name: string | null }) => [u.id, u.name]),
  );

  const payload = {
    entryId: params.entryId,
    challengeId: params.challengeId,
    etaMinutes: params.etaMinutes,
  };
  for (const userId of memberIds) {
    // Goes through notify() (not a raw INSERT) so it gets a real rendered
    // template like queue.called does — "queue" is the mandatory category so
    // every configured channel still fires regardless of preference.
    await notify(client, {
      userId,
      category: "queue",
      payload: {
        ...payload,
        template: "queue.precall",
        vars: {
          name: nameById.get(userId) ?? "",
          teamName,
          challengeName,
          etaMinutes: String(params.etaMinutes),
        },
      },
    });
    await broadcast(`${SSE_TOPICS.USER_PREFIX}${userId}`, EVENTS.USER_QUEUE_PRECALL, payload);
  }
}

/**
 * Signal only the participants whose own H38 read model can have changed.
 * The event intentionally carries just the challenge id; clients refetch the
 * authenticated read model instead of receiving another team's queue data.
 */
export async function notifyChallengeQueueChanged(
  client: Queryable,
  challengeId: number,
): Promise<void> {
  const { rows } = await client.query(
    `SELECT DISTINCT members.user_id
       FROM queue_entries qe
       JOIN (
         SELECT repo_id, user_id FROM submissions
         UNION
         SELECT repo_id, user_id FROM devpost_participants WHERE user_id IS NOT NULL
         UNION
         SELECT dp.repo_id, u.id AS user_id
           FROM devpost_participants dp
           JOIN users u
             ON lower(dp.email) = lower(u.email)
             OR (u.secondary_email_verified_at IS NOT NULL
                 AND lower(dp.email) = lower(u.secondary_email))
       ) members ON members.repo_id = qe.repo_id
      WHERE qe.challenge_id = $1`,
    [challengeId],
  );
  await Promise.all(
    rows.map((row: { user_id: number }) =>
      broadcast(`${SSE_TOPICS.USER_PREFIX}${row.user_id}`, EVENTS.USER_QUEUE_CHANGED, {
        challengeId,
      }),
    ),
  );
}

/** Notify participants whose queues are affected by a room-level change. */
export async function notifyRoomQueueChanged(client: Queryable, roomId: number): Promise<void> {
  const { rows } = await client.query(
    `SELECT challenge_id FROM room_challenges WHERE room_id = $1`,
    [roomId],
  );
  await Promise.all(
    rows.map((row: { challenge_id: number }) =>
      notifyChallengeQueueChanged(client, row.challenge_id),
    ),
  );
}
