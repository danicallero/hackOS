import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type { Queryable } from "../../db/pool.js";
import { broadcast } from "../../lib/sse.js";

/**
 * Team members for a repo, via `submissions` (H29/H31/H38: notifications go
 * to every member of the team behind the repo, not just whoever submitted).
 */
export async function repoMemberIds(client: Queryable, repoId: number): Promise<number[]> {
  const { rows } = await client.query(`SELECT user_id FROM submissions WHERE repo_id = $1`, [
    repoId,
  ]);
  return rows.map((r: { user_id: number }) => r.user_id);
}

/**
 * H29/H38: "ve a esperar a la sala X". Writes a durable notification_outbox
 * row per member (delivery is another workstream's job) and broadcasts on
 * the member's personal SSE topic so an open participant view updates live.
 */
export async function notifyTeamCalled(
  client: Queryable,
  params: {
    entryId: number;
    challengeId: number;
    repoId: number;
    roomId: number;
    roomName: string;
  },
): Promise<void> {
  const memberIds = await repoMemberIds(client, params.repoId);
  const payload = {
    entryId: params.entryId,
    challengeId: params.challengeId,
    roomId: params.roomId,
    roomName: params.roomName,
  };
  for (const userId of memberIds) {
    await client.query(
      `INSERT INTO notification_outbox (user_id, category, channel, payload) VALUES ($1, 'queue', 'push', $2)`,
      [userId, JSON.stringify(payload)],
    );
  }
  // Broadcast after the row is durably queued but still inside the caller's
  // transaction boundary is fine — SSE has no rollback semantics either way,
  // and callers only reach here once the domain write already validated.
  for (const userId of memberIds) {
    await broadcast(`${SSE_TOPICS.USER_PREFIX}${userId}`, EVENTS.USER_QUEUE_CALLED, payload);
  }
}

/** H38 pre-aviso: estimated wait <= queue_settings.pre_call_notification_eta_minutes. */
export async function notifyTeamPreCall(
  client: Queryable,
  params: { entryId: number; challengeId: number; repoId: number; etaMinutes: number },
): Promise<void> {
  const memberIds = await repoMemberIds(client, params.repoId);
  const payload = {
    entryId: params.entryId,
    challengeId: params.challengeId,
    etaMinutes: params.etaMinutes,
  };
  for (const userId of memberIds) {
    await client.query(
      `INSERT INTO notification_outbox (user_id, category, channel, payload) VALUES ($1, 'queue', 'push', $2)`,
      [userId, JSON.stringify(payload)],
    );
    await broadcast(`${SSE_TOPICS.USER_PREFIX}${userId}`, EVENTS.USER_QUEUE_PRECALL, payload);
  }
}
