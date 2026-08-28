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

type QueueNotificationEntry = {
  challenge_id: number;
  repo_id: number;
  status: string;
  assigned_room_id: number | null;
  precalled_at: Date | string | null;
};

type ParticipantInvalidationJobData = {
  challengeId: number;
  queueGroupId?: number;
  challengeIds?: number[];
};

const MERGE_PARTICIPANT_INVALIDATION_COMMAND = "h54_merge_participant_invalidation";
const MERGE_PARTICIPANT_INVALIDATION_LUA = `
local data = redis.call("HGET", KEYS[1], "data")
if not data then return 0 end

local current = cjson.decode(data)
local incoming = cjson.decode(ARGV[1])
local ids = {}
local seen = {}

local function add(value)
  if type(value) == "number" and value == math.floor(value) and not seen[value] then
    seen[value] = true
    table.insert(ids, value)
  end
end

add(current.challengeId)
if current.challengeIds then
  for _, value in ipairs(current.challengeIds) do add(value) end
end
for _, value in ipairs(incoming) do add(value) end

if #ids > 1 then
  current.challengeIds = ids
  redis.call("HSET", KEYS[1], "data", cjson.encode(current))
end
return #ids
`;
const mergeParticipantInvalidationClients = new WeakSet<object>();

/**
 * Merge topology challenge ids in Redis, rather than read/replace-writing the
 * BullMQ job hash. Queue workers run in multiple processes, so a pair of
 * concurrent `Job.updateData` calls can otherwise lose one side of the union.
 */
async function mergeDurableChallengeIds(
  queue: ReturnType<typeof getQueue>,
  jobId: string,
  challengeIds: readonly number[],
): Promise<void> {
  const client = await queue.client;
  if (!mergeParticipantInvalidationClients.has(client)) {
    client.defineCommand(MERGE_PARTICIPANT_INVALIDATION_COMMAND, {
      numberOfKeys: 1,
      lua: MERGE_PARTICIPANT_INVALIDATION_LUA,
    });
    mergeParticipantInvalidationClients.add(client);
  }
  await client.runCommand(MERGE_PARTICIPANT_INVALIDATION_COMMAND, [
    queue.toKey(jobId),
    JSON.stringify(challengeIds),
  ]);
}

/**
 * Notifications are invoked from the transition transaction, but their
 * inputs are plain ids/labels and can become stale when a helper is called
 * directly or reused by a future worker. Re-read and lock the entry before
 * emitting any participant-facing side effect so a call/pre-call can never
 * describe a row that has already moved on.
 */
async function lockNotificationEntry(
  client: Queryable,
  params: { entryId: number; challengeId: number; repoId: number },
  expectedStatus: string,
  requirePrecall = false,
  expectedRoomId?: number,
): Promise<QueueNotificationEntry | null> {
  const { rows } = await client.query<QueueNotificationEntry>(
    `SELECT challenge_id, repo_id, status, assigned_room_id, precalled_at
       FROM queue_entries
      WHERE id = $1
      FOR UPDATE`,
    [params.entryId],
  );
  const entry = rows[0];
  if (
    !entry ||
    Number(entry.challenge_id) !== params.challengeId ||
    Number(entry.repo_id) !== params.repoId ||
    entry.status !== expectedStatus ||
    (requirePrecall && entry.precalled_at == null) ||
    (expectedRoomId !== undefined &&
      (entry.assigned_room_id == null || Number(entry.assigned_room_id) !== expectedRoomId))
  ) {
    return null;
  }
  return entry;
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
  if (!(await lockNotificationEntry(client, params, "called", false, params.roomId))) {
    return;
  }
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
  if (!(await lockNotificationEntry(client, params, "waiting", true))) return;
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
  client: Queryable,
  challengeId: number,
  requestedGroupId?: number,
  relatedChallengeIds: readonly number[] = [],
): Promise<"queued" | "coalesced" | "dropped"> {
  const queue = getQueue(QUEUE_PARTICIPANT_INVALIDATIONS);
  let queueGroupId: number | null = null;
  try {
    const { rows: groupRows } = await client.query<{ queue_group_id: number }>(
      `SELECT queue_group_id
         FROM queue_group_challenges
        WHERE challenge_id = $1`,
      [challengeId],
    );
    queueGroupId = groupRows[0]?.queue_group_id ?? null;
    if (queueGroupId == null && requestedGroupId != null) {
      const { rows: requestedRows } = await client.query<{ queue_group_id: number }>(
        `SELECT queue_group_id
           FROM queue_group_challenges
          WHERE queue_group_id = $1
          LIMIT 1`,
        [requestedGroupId],
      );
      queueGroupId = requestedRows[0]?.queue_group_id ?? null;
    }
  } catch (err) {
    // Participant refresh is best effort. If the post-commit lookup is
    // unavailable, retain the old challenge-scoped debounce key instead of
    // turning a completed queue transition into a request failure.
    console.error(`[queue] unable to resolve invalidation group for challenge ${challengeId}`, err);
  }
  const jobId = queueGroupId == null ? `challenge-${challengeId}` : `group-${queueGroupId}`;
  const topologyChallengeIds =
    requestedGroupId == null
      ? []
      : [...new Set([challengeId, ...relatedChallengeIds].filter(Number.isFinite))];
  const locallyCoalesced = participantInvalidationJobsInFlight.has(jobId);
  participantInvalidationJobsInFlight.add(jobId);
  try {
    // The lookup is only telemetry; the jobId remains the correctness
    // mechanism. A concurrent caller may win between getJob() and add(), but
    // that race affects the counter only, never the single-job invariant.
    const existing = locallyCoalesced || Boolean(await queue.getJob(jobId));
    await queue.add(
      "challenge-changed",
      {
        challengeId,
        ...(queueGroupId == null ? {} : { queueGroupId }),
        ...(topologyChallengeIds.length > 1 ? { challengeIds: topologyChallengeIds } : {}),
      },
      {
        // H38 (#544): one delayed job per queue group is the debounce window.
        // Repeated transitions during a burst reuse this job instead of making
        // every participant refetch once per transition.
        jobId,
        delay: 250,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    if (topologyChallengeIds.length > 1) {
      // BullMQ returns the existing job when a duplicate jobId is added. An
      // ordinary queue transition may therefore already have created this
      // group's debounce job before a topology mutation contributes an
      // orphaned/source-side challenge. Merge the snapshot into that durable
      // job atomically or the later worker would fan out only the first
      // payload. The script is a single Redis operation across API replicas.
      await mergeDurableChallengeIds(queue, jobId, topologyChallengeIds);
    }
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

/** Queue row captured before an account/project deletion removes it. */
export type DeletedQueueEntryNotification = {
  id: number;
  challengeId: number;
  repoId: number;
  fixtureMarker: boolean | null;
};

/**
 * Publish deletion events after the owning transaction commits. The row no
 * longer exists, so callers must resolve its marker and ids before deleting;
 * the participant worker then re-reads the surviving group membership.
 */
export async function notifyDeletedQueueEntries(
  entries: readonly DeletedQueueEntryNotification[],
): Promise<void> {
  if (entries.length === 0) return;
  await Promise.all(
    entries.map((entry) =>
      broadcastQueueEventWithMarker(entry.fixtureMarker, EVENTS.QUEUE_ENTRY_CHANGED, {
        id: entry.id,
        challenge_id: entry.challengeId,
        repo_id: entry.repoId,
        deleted: true,
      }),
    ),
  );
  const challengeIds = new Set(entries.map((entry) => entry.challengeId));
  await Promise.all([...challengeIds].map((id) => notifyChallengeQueueChanged(pool, id)));
}

export type QueueTopologyInvalidation = {
  /** Queue groups before the topology mutation committed. */
  oldQueueGroupIds: readonly number[];
  /** Queue groups after the topology mutation committed. */
  newQueueGroupIds: readonly number[];
  /** Challenges present in the affected groups before the mutation. */
  oldChallengeIds: readonly number[];
  /** Challenges present in the affected groups after the mutation. */
  newChallengeIds: readonly number[];
};

/**
 * Queue topology changes can affect participants on both sides of a move:
 * changing a room's serving group changes the old queue's possible rooms as
 * well as the new queue's, and merging/splitting changes the queue key itself.
 * Callers take both snapshots inside their transaction and invoke this only
 * after commit. The group lookup here picks up challenges that stayed in a
 * surviving group; the snapshot challenge ids also cover groups that were
 * deleted or whose memberships moved during the transaction.
 *
 * `notifyChallengeQueueChanged` resolves each challenge to its current group,
 * while the source-group hint keeps an orphaned challenge's old queue from
 * losing its invalidation. Calls for several challenges in one shared group
 * retain the one delayed BullMQ job/coalescing contract.
 */
export async function notifyQueueTopologyChanged(
  client: Queryable,
  topology: QueueTopologyInvalidation,
): Promise<void> {
  const oldQueueGroupIds = [...new Set(topology.oldQueueGroupIds)].filter(Number.isFinite);
  const newQueueGroupIds = [...new Set(topology.newQueueGroupIds)].filter(Number.isFinite);
  const queueGroupIds = [...new Set([...oldQueueGroupIds, ...newQueueGroupIds])];
  const challengeIds = new Set(
    [...topology.oldChallengeIds, ...topology.newChallengeIds].filter(Number.isFinite),
  );

  if (queueGroupIds.length > 0) {
    try {
      const { rows } = await client.query<{ challenge_id: number }>(
        `SELECT DISTINCT challenge_id
           FROM queue_group_challenges
          WHERE queue_group_id = ANY($1::int[])`,
        [queueGroupIds],
      );
      for (const row of rows) challengeIds.add(Number(row.challenge_id));
    } catch (err) {
      // The topology write already committed. Snapshot challenge ids still
      // provide the best-effort invalidation path if this post-commit lookup
      // races a transient database failure.
      console.error("[queue] unable to resolve topology invalidation groups", err);
    }
  }

  const allGroupIds = [...new Set([...oldQueueGroupIds, ...newQueueGroupIds])];
  const topologyChallengeIds = [...challengeIds];
  await Promise.all(
    allGroupIds.length > 0
      ? [...challengeIds].flatMap((challengeId) =>
          allGroupIds.map((groupId) =>
            notifyChallengeQueueChanged(client, challengeId, groupId, topologyChallengeIds),
          ),
        )
      : [...challengeIds].map((challengeId) => notifyChallengeQueueChanged(client, challengeId)),
  );
}

/** Resolve a worker job's explicit group id against the post-mutation graph. */
async function resolveInvalidationGroupId(
  challengeId: number,
  requestedGroupId?: number,
): Promise<number | null> {
  const { rows: currentRows } = await pool.query<{ queue_group_id: number }>(
    `SELECT queue_group_id
       FROM queue_group_challenges
      WHERE challenge_id = $1`,
    [challengeId],
  );
  const currentGroupId = currentRows[0]?.queue_group_id;
  if (currentGroupId != null) return Number(currentGroupId);

  // A challenge may have been deleted from its old group while that group
  // still serves sibling challenges. If the job's group still exists and is
  // non-empty, publish that group's refresh; an empty/deleted stale id has no
  // safe recipient set and must be dropped.
  if (requestedGroupId == null) return null;
  const { rows: requestedRows } = await pool.query<{ queue_group_id: number }>(
    `SELECT qgc.queue_group_id
       FROM queue_group_challenges qgc
      WHERE qgc.queue_group_id = $1
      LIMIT 1`,
    [requestedGroupId],
  );
  return requestedRows[0] ? Number(requestedRows[0].queue_group_id) : null;
}

/** H38 (#544): worker-side fan-out, deliberately outside queue transition requests. */
export async function publishChallengeQueueInvalidation(
  challengeId: number,
  queueGroupId?: number,
  relatedChallengeIds: readonly number[] = [],
): Promise<void> {
  // Jobs carry the group id captured when the transition committed. A merge,
  // split, room reassignment, or deletion may have made that id stale by the
  // time BullMQ drains it, so always prefer the challenge's current group and
  // only use the explicit id when it still has members.
  const groupId = await resolveInvalidationGroupId(challengeId, queueGroupId);
  if (groupId == null) return;
  const fixtureMarker = await queueFixtureMarker(pool, "queueGroup", groupId);
  if (fixtureMarker === null) return;
  const challengeIds = (
    await pool.query<{ challenge_id: number }>(
      `SELECT challenge_id
         FROM queue_group_challenges
        WHERE queue_group_id = $1`,
      [groupId],
    )
  ).rows.map((row) => Number(row.challenge_id));
  // A topology mutation can leave the changed challenge temporarily
  // ungrouped while its source group still serves siblings. Include that
  // challenge's own entries in the source-group fan-out, but only when its
  // marker and enterprise still match the validated group. This preserves
  // the participant refresh without widening the fixture boundary.
  const relatedIds = [
    ...new Set([challengeId, ...relatedChallengeIds].filter(Number.isFinite)),
  ].filter((id) => !challengeIds.includes(id));
  if (relatedIds.length > 0) {
    const { rows: relatedRows } = await pool.query<{ id: number }>(
      `SELECT c.id
         FROM challenges c
         JOIN sponsors s ON s.id = c.author
         JOIN queue_groups qg ON qg.id = $2
        WHERE c.id = ANY($1::int[])
          AND c.is_test_account = $3
          AND s.enterprise_id = qg.enterprise_id`,
      [relatedIds, groupId, fixtureMarker],
    );
    for (const row of relatedRows) {
      const id = Number(row.id);
      if (!challengeIds.includes(id)) challengeIds.push(id);
    }
  }
  if (challengeIds.length === 0) return;
  const { rows } = await pool.query(
    `SELECT DISTINCT members.user_id
       FROM queue_entries qe
       JOIN challenges c
         ON c.id = qe.challenge_id
        AND c.is_test_account = $2
       JOIN repos r
         ON r.id = qe.repo_id
        AND r.is_test_account = $2
       JOIN (${REPO_MEMBER_RELATION_SQL}) members ON members.repo_id = qe.repo_id
       JOIN users u ON u.id = members.user_id
      WHERE qe.challenge_id = ANY($1::int[])
        AND u.is_test_account = $2
        AND u.account_state = 'active'
        AND u.anonymized_at IS NULL`,
    [challengeIds, fixtureMarker],
  );
  const results = await Promise.all(
    rows.map((row: { user_id: number }) =>
      broadcast(`${SSE_TOPICS.USER_PREFIX}${row.user_id}`, EVENTS.USER_QUEUE_CHANGED, {
        challengeId,
        ...(groupId == null ? {} : { queueGroupId: groupId }),
      }),
    ),
  );
  const degraded = results.filter((result) => result === null).length;
  if (degraded > 0) {
    for (let i = 0; i < degraded; i++) observeParticipantInvalidation("degraded");
    if (degraded === results.length) observeParticipantInvalidation("dropped");
  }
}

registerWorker(
  QUEUE_PARTICIPANT_INVALIDATIONS,
  async (job: Job<ParticipantInvalidationJobData>) => {
    await publishChallengeQueueInvalidation(
      job.data.challengeId,
      job.data.queueGroupId,
      job.data.challengeIds,
    );
  },
);

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
  const fixtureMarker = await queueFixtureMarker(client, "room", roomId);
  if (fixtureMarker === null) return;
  const challengeIds = await roomChallengeIds(client, roomId, fixtureMarker);
  await Promise.all(challengeIds.map((id) => notifyChallengeQueueChanged(client, id)));
}
