import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type { Job } from "bullmq";
import type { Queryable } from "../../db/pool.js";
import { pool } from "../../db/pool.js";
import { observeParticipantInvalidation } from "../../lib/metrics.js";
import { getQueue, registerWorker } from "../../lib/queues.js";
import { broadcast } from "../../lib/sse.js";
import { notify, QUEUE_STAFF_CATEGORY } from "../notifications/service.js";
import { broadcastQueueEventWithMarker, queueFixtureMarker } from "./broadcast.js";
import { roomChallengeIds } from "./groups.js";
import { REPO_MEMBER_RELATION_SQL } from "./membership.js";

/**
 * Team members for a repo. `submissions` is the normal source, while the
 * Devpost fallback keeps notifications correct during or after an import even
 * if a legacy participant row has not yet gained its submission.
 */
export async function repoMemberIds(
  client: Queryable,
  repoId: number,
  fixtureMarker?: boolean,
): Promise<number[]> {
  const { rows } = await client.query(
    `SELECT DISTINCT m.user_id
       FROM (${REPO_MEMBER_RELATION_SQL}) m
       JOIN users u ON u.id = m.user_id
      WHERE m.repo_id = $1
        ${fixtureMarker === undefined ? "" : "AND u.is_test_account = $2"}`,
    fixtureMarker === undefined ? [repoId] : [repoId, fixtureMarker],
  );
  return rows.map((r: { user_id: number }) => r.user_id);
}

/** Shared context (challenge/team names + member id-to-name map) every notifyTeam* helper needs. */
async function loadNotifyContext(
  client: Queryable,
  params: { challengeId: number; repoId: number; memberIds: number[] },
): Promise<{ challengeName: string; teamName: string; nameById: Map<number, string | null> }> {
  const { rows: ctxRows } = await client.query(
    `SELECT c.title AS challenge_name, r.name AS team_name FROM challenges c, repos r
      WHERE c.id = $1 AND r.id = $2`,
    [params.challengeId, params.repoId],
  );
  const challengeName: string = ctxRows[0]?.challenge_name ?? "";
  const teamName: string = ctxRows[0]?.team_name ?? "";

  const { rows: userRows } = await client.query(
    `SELECT id, name FROM users
      WHERE id = ANY($1)
        AND account_state = 'active' AND anonymized_at IS NULL`,
    [params.memberIds],
  );
  const nameById = new Map<number, string | null>(
    userRows.map((u: { id: number; name: string | null }) => [u.id, u.name]),
  );

  return { challengeName, teamName, nameById };
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
  const fixtureMarker = await queueFixtureMarker(client, "entry", params.entryId);
  if (fixtureMarker === null) return;
  const memberIds = await repoMemberIds(client, params.repoId, fixtureMarker);
  if (memberIds.length === 0) return;

  const { challengeName, teamName, nameById } = await loadNotifyContext(client, {
    challengeId: params.challengeId,
    repoId: params.repoId,
    memberIds,
  });

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
      fixtureMarker,
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
  await broadcastQueueEventWithMarker(fixtureMarker, EVENTS.QUEUE_TEAM_CALLED, {
    ...payload,
    teamName,
  });
  // H29: same opt-in staff push used by notify-enter (queue.staff), so
  // operators with a backgrounded app still get a device notification the
  // moment a team is called, not just the live SSE echo above.
  const { rows: staffRows } = await client.query(
    `SELECT DISTINCT np.user_id
       FROM notification_preferences np
       JOIN users u ON u.id = np.user_id
      WHERE np.category = $1 AND np.channel = 'push' AND np.enabled = true
        AND u.account_state = 'active' AND u.anonymized_at IS NULL
        AND u.is_test_account = $2`,
    [QUEUE_STAFF_CATEGORY, fixtureMarker],
  );
  for (const row of staffRows as { user_id: number }[]) {
    await notify(client, {
      userId: row.user_id,
      category: QUEUE_STAFF_CATEGORY,
      channels: ["push"],
      payload: {
        entryId: params.entryId,
        roomId: params.roomId,
        template: "queue.staff.called",
        vars: { teamName, challengeName, roomName: params.roomName },
      },
      fixtureMarker,
    });
  }
}

/** H38 pre-aviso: estimated wait <= queue_settings.pre_call_notification_eta_minutes. */
export async function notifyTeamPreCall(
  client: Queryable,
  params: { entryId: number; challengeId: number; repoId: number; etaMinutes: number },
): Promise<void> {
  const fixtureMarker = await queueFixtureMarker(client, "entry", params.entryId);
  if (fixtureMarker === null) return;
  const memberIds = await repoMemberIds(client, params.repoId, fixtureMarker);
  if (memberIds.length === 0) return;

  const { challengeName, teamName, nameById } = await loadNotifyContext(client, {
    challengeId: params.challengeId,
    repoId: params.repoId,
    memberIds,
  });

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
      fixtureMarker,
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
  _client: Queryable,
  challengeId: number,
): Promise<"queued" | "coalesced" | "dropped"> {
  const queue = getQueue(QUEUE_PARTICIPANT_INVALIDATIONS);
  const jobId = `challenge-${challengeId}`;
  const locallyCoalesced = participantInvalidationJobsInFlight.has(jobId);
  participantInvalidationJobsInFlight.add(jobId);
  try {
    // The lookup is only telemetry; the jobId remains the correctness
    // mechanism. A concurrent caller may win between getJob() and add(), but
    // that race affects the counter only, never the single-job invariant.
    const existing = locallyCoalesced || Boolean(await queue.getJob(jobId));
    await queue.add(
      "challenge-changed",
      { challengeId },
      {
        // H38 (#544): one delayed job per challenge is the debounce window.
        // Repeated transitions during a burst reuse this job instead of making
        // every participant refetch once per transition.
        jobId,
        delay: 250,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    const outcome = existing ? "coalesced" : "queued";
    observeParticipantInvalidation(outcome);
    return outcome;
  } catch (err) {
    // The durable queue transition has already committed when this helper is
    // called. Participant refresh is best effort, so a Valkey/BullMQ outage
    // must not turn a successful operational action into a 500 (H29/H38).
    observeParticipantInvalidation("dropped");
    console.error(`[queue] participant invalidation for challenge ${challengeId} dropped`, err);
    return "dropped";
  } finally {
    participantInvalidationJobsInFlight.delete(jobId);
  }
}

export const QUEUE_PARTICIPANT_INVALIDATIONS = "queue-participant-invalidations";
const participantInvalidationJobsInFlight = new Set<string>();

/** H38 (#544): worker-side fan-out, deliberately outside queue transition requests. */
export async function publishChallengeQueueInvalidation(challengeId: number): Promise<void> {
  const fixtureMarker = await queueFixtureMarker(pool, "challenge", challengeId);
  if (fixtureMarker === null) return;
  const { rows } = await pool.query(
    `SELECT DISTINCT members.user_id
       FROM queue_entries qe
       JOIN (${REPO_MEMBER_RELATION_SQL}) members ON members.repo_id = qe.repo_id
       JOIN users u ON u.id = members.user_id
      WHERE qe.challenge_id = $1 AND u.is_test_account = $2`,
    [challengeId, fixtureMarker],
  );
  const results = await Promise.all(
    rows.map((row: { user_id: number }) =>
      broadcast(`${SSE_TOPICS.USER_PREFIX}${row.user_id}`, EVENTS.USER_QUEUE_CHANGED, {
        challengeId,
      }),
    ),
  );
  const degraded = results.filter((result) => result === null).length;
  if (degraded > 0) {
    for (let i = 0; i < degraded; i++) observeParticipantInvalidation("degraded");
    if (degraded === results.length) observeParticipantInvalidation("dropped");
  }
}

registerWorker(QUEUE_PARTICIPANT_INVALIDATIONS, async (job: Job<{ challengeId: number }>) => {
  await publishChallengeQueueInvalidation(job.data.challengeId);
});

/**
 * H46: free-text message from staff / a sponsor rep to one team, sent over the
 * same mandatory `queue` category the calls use — the point is to be able to
 * reach a team back (e.g. "come back to room 2, we have a question about your
 * demo"), so it must not be silenceable by notification preferences.
 * Returns how many recipients it reached.
 */
export async function notifyTeamMessage(
  client: Queryable,
  params: {
    entryId: number;
    challengeId: number;
    repoId: number;
    senderName: string;
    message: string;
  },
): Promise<number> {
  const fixtureMarker = await queueFixtureMarker(client, "entry", params.entryId);
  if (fixtureMarker === null) return 0;
  const memberIds = await repoMemberIds(client, params.repoId, fixtureMarker);
  if (memberIds.length === 0) return 0;

  const { challengeName, teamName, nameById } = await loadNotifyContext(client, {
    challengeId: params.challengeId,
    repoId: params.repoId,
    memberIds,
  });

  const payload = {
    entryId: params.entryId,
    challengeId: params.challengeId,
    message: params.message,
    senderName: params.senderName,
  };
  for (const userId of memberIds) {
    await notify(client, {
      userId,
      category: "queue",
      payload: {
        ...payload,
        template: "queue.message",
        vars: {
          name: nameById.get(userId) ?? "",
          teamName,
          challengeName,
          senderName: params.senderName,
          message: params.message,
        },
      },
      fixtureMarker,
    });
    await broadcast(`${SSE_TOPICS.USER_PREFIX}${userId}`, EVENTS.USER_QUEUE_MESSAGE, payload);
  }
  return memberIds.length;
}

/** Notify participants whose queues are affected by a room-level change. */
export async function notifyRoomQueueChanged(client: Queryable, roomId: number): Promise<void> {
  // H46: a room serves a queue_group, so a room-level change affects every
  // challenge feeding that group — one today, 1..N once groups are merged.
  const challengeIds = await roomChallengeIds(client, roomId);
  await Promise.all(challengeIds.map((id) => notifyChallengeQueueChanged(client, id)));
}
