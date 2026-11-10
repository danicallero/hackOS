import { ERROR_REASONS } from "@hackos/shared/error-reasons";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type { PoolClient } from "pg";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { afterCommit } from "../../lib/after-commit.js";
import { audit } from "../../lib/audit.js";
import { isUniqueViolation } from "../../lib/db-errors.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { broadcast } from "../../lib/sse.js";
import { type DirectoryEntry, visibleDirectoryEntries } from "../directory/service.js";
import { hasEventAccess } from "../identity/role.js";
import { type NotifyOptions, notifyMany } from "../notifications/service.js";
import { challengeSponsorUserIds } from "../queue/reviews.js";
import {
  CARD_COLUMNS,
  type CardRow,
  challengeLimit,
  DISPLAY_NAME_SQL,
  type HelperKind,
  type HelpTopic,
  isEligibleHelper,
  LISTED_HELPER_WHERE,
  presentSql,
  toCard,
} from "./helpers.js";
import { assertHelpdeskOpen, eventAccessOnly } from "./schedule.js";
import type { ClaimInput, CreateRequestInput, EditRequestInput } from "./schemas.js";
import { assertTopicsExist } from "./topics.js";

/**
 * H64-H66 help requests.
 *
 * Lifecycle: open → claimed → resolved, with two exits: the requester (or any
 * team member) cancels an open or claimed request, and the claiming helper
 * releases a claim back to open (to hand it over or change where to meet).
 * Resolving is allowed only once claimed, by the claimer or the requesting
 * side. At most one request per team (or per person, for individual requests)
 * is active at a time.
 *
 * Routing (H65) happens once, at creation: the audience is every listed
 * helper who is both inside a stated availability interval (H62) and present
 * at the venue (H24). Helpers whose knowledge matches ANY requested topic are
 * notified; when Other is selected or nobody matches, the whole audience is
 * notified (fallback). Nobody available leaves the request open with routing
 * `none`; it stays visible in every helper's inbox.
 */

export type HelpRequestStatus = "open" | "claimed" | "resolved" | "cancelled";
export type MeetingMode = "on_my_way" | "meet_at";
export type RoutingOutcome = "matched" | "fallback" | "sponsor" | "none";

export const HELPDESK_CATEGORY = "helpdesk";
const CHANNELS: NotifyOptions["channels"] = ["in_app", "push"];

export interface HelpRequestView {
  id: number;
  status: HelpRequestStatus;
  description: string;
  location: string;
  topics: HelpTopic[];
  other: boolean;
  challenge: { id: number; name: string } | null;
  preferSponsor: boolean;
  project: { id: number; name: string } | null;
  requester: { userId: number; displayName: string } | null;
  routing: RoutingOutcome;
  notifiedCount: number;
  claim: null | {
    helper: {
      userId: number;
      displayName: string;
      photoUrl: string | null;
      kind: HelperKind;
      visibleRoleName: string | null;
      affiliation: string | null;
    } | null;
    mode: MeetingMode;
    meetingLocation: string | null;
    claimedAt: string;
  };
  createdAt: string;
  /** Place in the first-come, first-served queue; moves to the end when the request is edited. */
  queuedAt: string;
  /** 1-based among all open requests; null once claimed or closed. */
  queuePosition: number | null;
  resolvedAt: string | null;
  cancelledAt: string | null;
  viewer: {
    canCancel: boolean;
    canEdit: boolean;
    canClaim: boolean;
    canRelease: boolean;
    canResolve: boolean;
    notified: boolean;
  };
}

interface RequestRow {
  id: number;
  status: HelpRequestStatus;
  description: string;
  location: string;
  other: boolean;
  challenge_id: number | null;
  challenge_name: string | null;
  prefer_sponsor: boolean;
  routing: RoutingOutcome;
  requester_id: number | null;
  requester_name: string | null;
  repo_id: number | null;
  repo_name: string | null;
  claimed_by: number | null;
  claimed_at: Date | null;
  meeting_mode: MeetingMode | null;
  meeting_location: string | null;
  resolved_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
  queued_at: Date;
  queue_position: number | null;
  topics: HelpTopic[];
  notified_count: number;
  viewer_notified: boolean;
  viewer_on_team: boolean;
}

/** `$1` is always the viewer id. */
function requestSelect(where: string, order: string, limit = 100): string {
  return `
  SELECT hr.id, hr.status, hr.description, hr.location, hr.other, hr.routing,
         hr.challenge_id, ch.title AS challenge_name, hr.prefer_sponsor,
         hr.requester_id,
         CASE WHEN u.id IS NOT NULL THEN ${DISPLAY_NAME_SQL} END AS requester_name,
         hr.repo_id, rp.name AS repo_name,
         hr.claimed_by, hr.claimed_at, hr.meeting_mode, hr.meeting_location,
         hr.resolved_at, hr.cancelled_at, hr.created_at, hr.queued_at,
         CASE WHEN hr.status = 'open' THEN (
           SELECT count(*)::int + 1 FROM help_requests q
            WHERE q.status = 'open' AND (q.queued_at, q.id) < (hr.queued_at, hr.id)
         ) END AS queue_position,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) ORDER BY lower(t.name), t.id)
                     FROM help_request_topics rt JOIN help_topics t ON t.id = rt.topic_id
                    WHERE rt.request_id = hr.id), '[]'::jsonb) AS topics,
         (SELECT count(*)::int FROM help_request_recipients rr WHERE rr.request_id = hr.id) AS notified_count,
         EXISTS (SELECT 1 FROM help_request_recipients rr
                  WHERE rr.request_id = hr.id AND rr.user_id = $1) AS viewer_notified,
         (hr.requester_id = $1 OR (hr.repo_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM submissions s WHERE s.repo_id = hr.repo_id AND s.user_id = $1
               AND s.status = 'active'))) AS viewer_on_team
    FROM help_requests hr
    LEFT JOIN users u ON u.id = hr.requester_id
    LEFT JOIN user_public_profiles pp ON pp.user_id = u.id
    LEFT JOIN repos rp ON rp.id = hr.repo_id
    LEFT JOIN challenges ch ON ch.id = hr.challenge_id
   WHERE ${where}
   ORDER BY ${order}
   LIMIT ${limit}`;
}

async function claimers(db: Queryable, ids: number[]): Promise<Map<number, CardRow>> {
  if (ids.length === 0) return new Map();
  const { rows } = await db.query<CardRow>(
    `SELECT ${CARD_COLUMNS}
       FROM users u LEFT JOIN user_public_profiles pp ON pp.user_id = u.id
      WHERE u.id = ANY($1::int[])`,
    [ids],
  );
  return new Map(rows.map((r) => [Number(r.user_id), r]));
}

async function toViews(
  db: Queryable,
  rows: RequestRow[],
  viewerIsHelper: boolean,
  viewerId: number,
  limit: number[] | null = null,
): Promise<HelpRequestView[]> {
  const claimerRows = await claimers(db, [
    ...new Set(rows.flatMap((r) => (r.claimed_by != null ? [Number(r.claimed_by)] : []))),
  ]);
  return rows.map((r) => {
    const active = r.status === "open" || r.status === "claimed";
    const claimer = r.claimed_by != null ? claimerRows.get(Number(r.claimed_by)) : undefined;
    const card = claimer ? toCard(claimer) : null;
    const isClaimer = r.claimed_by != null && Number(r.claimed_by) === viewerId;
    return {
      id: Number(r.id),
      status: r.status,
      description: r.description,
      location: r.location,
      topics: r.topics.map((t) => ({ id: Number(t.id), name: t.name })),
      other: r.other,
      challenge:
        r.challenge_id != null && r.challenge_name != null
          ? { id: Number(r.challenge_id), name: r.challenge_name }
          : null,
      preferSponsor: r.prefer_sponsor,
      project:
        r.repo_id != null && r.repo_name != null
          ? { id: Number(r.repo_id), name: r.repo_name }
          : null,
      requester:
        r.requester_id != null && r.requester_name != null
          ? { userId: Number(r.requester_id), displayName: r.requester_name }
          : null,
      routing: r.routing,
      notifiedCount: Number(r.notified_count),
      claim:
        r.claimed_at && r.meeting_mode
          ? {
              helper: card
                ? {
                    userId: card.userId,
                    displayName: card.displayName,
                    photoUrl: card.photoUrl,
                    kind: card.kind,
                    visibleRoleName: card.visibleRoleName,
                    affiliation: card.affiliation,
                  }
                : null,
              mode: r.meeting_mode,
              meetingLocation: r.meeting_location,
              claimedAt: r.claimed_at.toISOString(),
            }
          : null,
      createdAt: r.created_at.toISOString(),
      queuedAt: r.queued_at.toISOString(),
      queuePosition: r.queue_position == null ? null : Number(r.queue_position),
      resolvedAt: r.resolved_at?.toISOString() ?? null,
      cancelledAt: r.cancelled_at?.toISOString() ?? null,
      viewer: {
        canCancel: active && r.viewer_on_team,
        canEdit: r.status === "open" && r.viewer_on_team,
        canClaim:
          r.status === "open" &&
          viewerIsHelper &&
          !r.viewer_on_team &&
          (limit === null || (r.challenge_id != null && limit.includes(Number(r.challenge_id)))),
        canRelease: r.status === "claimed" && isClaimer,
        canResolve: r.status === "claimed" && (isClaimer || r.viewer_on_team),
        notified: r.viewer_notified,
      },
    };
  });
}

/** Eligible AND published: what claiming and the helper inbox require. */
async function isActiveHelper(db: Queryable, userId: number): Promise<boolean> {
  const { rows } = await db.query(
    "SELECT 1 FROM helper_profiles WHERE user_id = $1 AND published",
    [userId],
  );
  return rows.length > 0 && (await isEligibleHelper(db, userId));
}

async function viewOne(db: Queryable, viewerId: number, id: number): Promise<HelpRequestView> {
  const { rows } = await db.query<RequestRow>(requestSelect("hr.id = $2", "hr.id", 1), [
    viewerId,
    id,
  ]);
  if (!rows[0]) throw new NotFoundError("Help request not found");
  const [view] = await toViews(
    db,
    rows,
    await isActiveHelper(db, viewerId),
    viewerId,
    await challengeLimit(db, viewerId),
  );
  return view as HelpRequestView;
}

/**
 * Read one request: the requesting side, eligible helpers and coverage
 * readers. Everyone else gets 404, so ids cannot be probed.
 *
 * `requesterProfile` (H64, H66): the requester's public profile in the
 * directory entry shape, only for a notified recipient, the request's
 * claimer or `helpdesk:manage`, and only while the requester shares their
 * public profile (`directory_visible`); otherwise null. No diary or contact
 * is created.
 */
export async function getRequest(
  viewerId: number,
  id: number,
  access: { canSeeAll: boolean; canManage: boolean },
): Promise<HelpRequestView & { requesterProfile: DirectoryEntry | null }> {
  const view = await viewOne(pool, viewerId, id);
  const onTeam = view.viewer.canCancel || (await onRequestTeam(pool, viewerId, id));
  if (!onTeam && !access.canSeeAll && !access.canManage) {
    if (!(await isEligibleHelper(pool, viewerId)))
      throw new NotFoundError("Help request not found");
    // H65: a helper limited to some challenges only reads those requests
    // (and any they claimed).
    const limit = await challengeLimit(pool, viewerId);
    const own = view.claim?.helper?.userId === viewerId;
    if (limit && !own && !(view.challenge && limit.includes(view.challenge.id))) {
      throw new NotFoundError("Help request not found");
    }
  }
  const mayOpenRequester =
    !onTeam &&
    (access.canManage || view.viewer.notified || view.claim?.helper?.userId === viewerId);
  const requesterProfile =
    mayOpenRequester && view.requester
      ? ((await visibleDirectoryEntries(pool, [view.requester.userId])).get(
          view.requester.userId,
        ) ?? null)
      : null;
  return { ...view, requesterProfile };
}

async function onRequestTeam(db: Queryable, userId: number, id: number): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM help_requests hr
      WHERE hr.id = $2 AND (hr.requester_id = $1 OR (hr.repo_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM submissions s WHERE s.repo_id = hr.repo_id AND s.user_id = $1
           AND s.status = 'active')))`,
    [userId, id],
  );
  return rows.length > 0;
}

export async function listMyRequests(userId: number): Promise<HelpRequestView[]> {
  const { rows } = await pool.query<RequestRow>(
    requestSelect(
      `(hr.requester_id = $1 OR hr.repo_id IN (
          SELECT s.repo_id FROM submissions s WHERE s.user_id = $1 AND s.status = 'active'))`,
      "hr.created_at DESC, hr.id DESC",
      50,
    ),
    [userId],
  );
  return toViews(pool, rows, await isActiveHelper(pool, userId), userId);
}

export async function listInbox(
  userId: number,
  scope: "open" | "mine",
): Promise<HelpRequestView[]> {
  if (!(await isEligibleHelper(pool, userId))) {
    throw new ForbiddenError("Only mentors, sponsor representatives and staff can offer help", {
      code: ERROR_REASONS.HELPER_NOT_ELIGIBLE,
    });
  }
  const limit = await challengeLimit(pool, userId);
  const { rows } = await pool.query<RequestRow>(
    scope === "open"
      ? requestSelect(
          `hr.status = 'open' AND ($2::int[] IS NULL OR hr.challenge_id = ANY($2::int[]))`,
          "hr.queued_at, hr.id",
        )
      : requestSelect(
          "hr.claimed_by = $1 AND hr.status IN ('claimed', 'resolved')",
          "(hr.status = 'claimed') DESC, hr.claimed_at DESC, hr.id DESC",
          50,
        ),
    scope === "open" ? [userId, limit] : [userId],
  );
  return toViews(pool, rows, await isActiveHelper(pool, userId), userId, limit);
}

/**
 * Visible challenges a help request may target (H64). The challenges the
 * caller's own projects are queued for come first, flagged `mine`.
 */
export async function listRequestChallenges(
  userId: number,
): Promise<{ id: number; name: string; mine: boolean }[]> {
  const { rows } = await pool.query<{ id: number; title: string; mine: boolean }>(
    `SELECT c.id, c.title,
            EXISTS (SELECT 1 FROM queue_entries qe
                     JOIN submissions s ON s.repo_id = qe.repo_id
                    WHERE qe.challenge_id = c.id AND s.user_id = $1 AND s.status = 'active') AS mine
       FROM challenges c
      WHERE c.visibility = 'visible' AND c.is_test_account = false
      ORDER BY mine DESC, lower(c.title), c.id`,
    [userId],
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.title, mine: r.mine }));
}

async function lockActiveUser(db: Queryable, userId: number): Promise<void> {
  const { rows } = await db.query(
    `SELECT 1 FROM users WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
      FOR SHARE`,
    [userId],
  );
  if (!rows[0]) {
    throw new ConflictError("This account is being removed", { code: "account_removal_pending" });
  }
}

async function teamMembers(db: Queryable, repoId: number | null): Promise<number[]> {
  if (repoId == null) return [];
  const { rows } = await db.query<{ user_id: number }>(
    "SELECT DISTINCT user_id FROM submissions WHERE repo_id = $1 AND status = 'active'",
    [repoId],
  );
  return rows.map((r) => Number(r.user_id));
}

/** Requester plus active team members still able to receive notices. */
async function requestingSide(
  db: Queryable,
  requesterId: number | null,
  repoId: number | null,
): Promise<number[]> {
  const ids = new Set(await teamMembers(db, repoId));
  if (requesterId != null) ids.add(requesterId);
  if (ids.size === 0) return [];
  const { rows } = await db.query<{ id: number }>(
    `SELECT id FROM users WHERE id = ANY($1::int[])
        AND account_state = 'active' AND anonymized_at IS NULL ORDER BY id`,
    [[...ids]],
  );
  return rows.map((r) => Number(r.id));
}

function announce(requestId: number, status: HelpRequestStatus, userIds: Iterable<number>) {
  const ids = [...new Set(userIds)];
  return afterCommit("helpdesk.request.changed", () =>
    Promise.all(
      ids.map((id) =>
        broadcast(`${SSE_TOPICS.USER_PREFIX}${id}`, EVENTS.HELPDESK_REQUEST_CHANGED, {
          requestId,
          status,
        }),
      ),
    ),
  );
}

async function recipientIds(db: Queryable, requestId: number): Promise<number[]> {
  const { rows } = await db.query<{ user_id: number }>(
    "SELECT user_id FROM help_request_recipients WHERE request_id = $1",
    [requestId],
  );
  return rows.map((r) => Number(r.user_id));
}

/**
 * H65 audience at this moment, among present
 * listed helpers:
 *  1. a helper who limited their alerts to some challenges is a candidate
 *     only for requests on one of those challenges;
 *  2. sponsors of the request's challenge match regardless of topic;
 *  3. with `preferSponsor` and a sponsor of the chosen challenge, only those sponsors
 *     are notified (`sponsor`); otherwise the usual matched/fallback/none.
 */
async function routeAudience(
  db: Queryable,
  requesterSide: number[],
  topicIds: number[],
  other: boolean,
  challengeId: number | null,
  preferSponsor: boolean,
): Promise<{ routing: RoutingOutcome; userIds: number[] }> {
  const challengeSponsors = new Set(
    challengeId != null ? await challengeSponsorUserIds(db, challengeId) : [],
  );
  const { rows } = await db.query<{
    user_id: number;
    matches: boolean;
    challenge_ok: boolean;
  }>(
    `SELECT u.id AS user_id,
            -- A helper with no topics is a generalist: any request matches (H61, H65).
            NOT EXISTS (SELECT 1 FROM helper_topics ht WHERE ht.user_id = u.id)
              OR EXISTS (SELECT 1 FROM helper_topics ht
                          WHERE ht.user_id = u.id AND ht.topic_id = ANY($2::int[])) AS matches,
            NOT EXISTS (SELECT 1 FROM helper_profile_challenges hc WHERE hc.user_id = u.id)
              OR EXISTS (SELECT 1 FROM helper_profile_challenges hc
                          WHERE hc.user_id = u.id AND hc.challenge_id = $3::int) AS challenge_ok
       FROM helper_profiles hp
       JOIN users u ON u.id = hp.user_id
      WHERE ${LISTED_HELPER_WHERE}
        AND ${presentSql("u.id")}
        AND NOT (u.id = ANY($1::int[]))
      ORDER BY u.id`,
    [requesterSide, topicIds, challengeId],
  );
  const candidates = rows.filter((r) => r.challenge_ok);
  const matched = candidates.filter((r) => r.matches || challengeSponsors.has(Number(r.user_id)));
  if (preferSponsor) {
    const sponsors = matched
      .filter((r) => challengeSponsors.has(Number(r.user_id)))
      .map((r) => Number(r.user_id));
    if (sponsors.length > 0) return { routing: "sponsor", userIds: sponsors };
  }
  if (!other && matched.length > 0) {
    return { routing: "matched", userIds: matched.map((r) => Number(r.user_id)) };
  }
  if (candidates.length === 0) return { routing: "none", userIds: [] };
  return { routing: "fallback", userIds: candidates.map((r) => Number(r.user_id)) };
}

export async function createRequest(
  userId: number,
  input: CreateRequestInput,
): Promise<HelpRequestView> {
  const topicIds = [...new Set(input.topicIds)].sort((a, b) => a - b);
  const result = await withTransaction(async (client) => {
    await lockActiveUser(client, userId);
    if ((await eventAccessOnly(client)) && !(await hasEventAccess(client, userId))) {
      throw new ForbiddenError("The help desk is only available to event attendees");
    }
    await assertHelpdeskOpen(client);
    // Always for the caller: a person's request, never a team's.
    const repoId = null;
    await assertTopicsExist(client, topicIds);
    const challengeId = input.challengeId ?? null;
    if (challengeId != null) {
      const { rows } = await client.query(
        "SELECT 1 FROM challenges WHERE id = $1 AND visibility = 'visible' AND is_test_account = false",
        [challengeId],
      );
      if (!rows[0]) throw new BadRequestError("Choose a visible challenge", { challengeId });
    }
    const active = await client.query<{ id: number }>(
      `SELECT id FROM help_requests
        WHERE status IN ('open', 'claimed')
          AND (${repoId != null ? "repo_id = $1" : "repo_id IS NULL AND requester_id = $1"})`,
      [repoId ?? userId],
    );
    if (active.rows[0]) {
      throw new ConflictError("There is already an active help request", {
        code: ERROR_REASONS.HELP_REQUEST_ACTIVE,
        requestId: Number(active.rows[0].id),
      });
    }
    const side = await requestingSide(client, userId, repoId);
    const { routing, userIds } = await routeAudience(
      client,
      side,
      topicIds,
      input.other,
      challengeId,
      input.preferSponsor,
    );
    let id: number;
    try {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO help_requests
           (requester_id, repo_id, description, location, other, routing, challenge_id, prefer_sponsor)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          userId,
          repoId,
          input.description,
          input.location,
          input.other,
          routing,
          challengeId,
          input.preferSponsor,
        ],
      );
      id = Number((rows[0] as { id: number }).id);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError("There is already an active help request", {
          code: ERROR_REASONS.HELP_REQUEST_ACTIVE,
        });
      }
      throw err;
    }
    if (topicIds.length > 0) {
      await client.query(
        "INSERT INTO help_request_topics (request_id, topic_id) SELECT $1, unnest($2::int[])",
        [id, topicIds],
      );
    }
    if (userIds.length > 0) {
      await client.query(
        `INSERT INTO help_request_recipients (request_id, user_id)
         SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`,
        [id, userIds],
      );
      const { rows: names } = await client.query<{ name: string }>(
        `SELECT t.name FROM help_topics t WHERE t.id = ANY($1::int[]) ORDER BY lower(t.name)`,
        [topicIds],
      );
      const topicNames = names.map((n) => n.name);
      await notifyMany(
        client,
        userIds.map((helperId) => ({
          userId: helperId,
          category: HELPDESK_CATEGORY,
          channels: CHANNELS,
          payload: {
            template: topicNames.length === 0 ? "helpdesk.requestOther" : "helpdesk.request",
            vars: { topics: topicNames.join(", "), location: input.location },
            kind: "request_created",
            requestId: id,
          },
        })),
      );
    }
    await audit(client, {
      actorId: userId,
      entityType: "help_request",
      entityId: id,
      action: "created",
      after: {
        repoId,
        topicIds,
        other: input.other,
        challengeId,
        preferSponsor: input.preferSponsor,
        routing,
        notified: userIds.length,
      },
    });
    return { id, side, userIds };
  });
  await announce(result.id, "open", [...result.side, ...result.userIds]);
  return viewOne(pool, userId, result.id);
}

/**
 * H64, H65: the requesting side edits an OPEN request. It takes the same
 * validation as creation, goes to the end of the queue (`queued_at = now()`)
 * and is routed again: only helpers who newly match are notified, nobody who
 * already received it is told twice. Claimed or closed requests answer 409;
 * the row lock serializes the edit against a simultaneous claim.
 */
export async function editRequest(
  userId: number,
  id: number,
  input: EditRequestInput,
): Promise<HelpRequestView> {
  const topicIds = [...new Set(input.topicIds)].sort((a, b) => a - b);
  const result = await withTransaction(async (client) => {
    await lockActiveUser(client, userId);
    const req = await lockRequest(client, id);
    const side = await requestingSide(client, req.requester_id, req.repo_id);
    if (!side.includes(userId)) throw new NotFoundError("Help request not found");
    if (req.status === "claimed") {
      throw new ConflictError("A helper already claimed this request", {
        code: ERROR_REASONS.HELP_REQUEST_ALREADY_CLAIMED,
      });
    }
    if (req.status !== "open") {
      throw new ConflictError("This help request is closed", {
        code: ERROR_REASONS.HELP_REQUEST_CLOSED,
      });
    }
    await assertTopicsExist(client, topicIds);
    const challengeId = input.challengeId ?? null;
    if (challengeId != null) {
      const { rows } = await client.query(
        "SELECT 1 FROM challenges WHERE id = $1 AND visibility = 'visible' AND is_test_account = false",
        [challengeId],
      );
      if (!rows[0]) throw new BadRequestError("Choose a visible challenge", { challengeId });
    }
    const { rows: before } = await client.query<{
      description: string;
      location: string;
      other: boolean;
      challenge_id: number | null;
      prefer_sponsor: boolean;
      routing: RoutingOutcome;
      topic_ids: number[];
    }>(
      `SELECT hr.description, hr.location, hr.other, hr.challenge_id, hr.prefer_sponsor, hr.routing,
              COALESCE((SELECT array_agg(topic_id ORDER BY topic_id) FROM help_request_topics
                         WHERE request_id = hr.id), '{}') AS topic_ids
         FROM help_requests hr WHERE hr.id = $1`,
      [id],
    );
    const old = before[0] as NonNullable<(typeof before)[number]>;
    const existing = await recipientIds(client, id);
    const audience = await routeAudience(
      client,
      side,
      topicIds,
      input.other,
      challengeId,
      input.preferSponsor,
    );
    const fresh = audience.userIds.filter((helperId) => !existing.includes(helperId));
    // Keep the original outcome when the edit finds nobody new but people were already told.
    const routing =
      audience.routing === "none" && existing.length > 0 ? old.routing : audience.routing;
    await client.query(
      `UPDATE help_requests
          SET description = $2, location = $3, other = $4, challenge_id = $5,
              prefer_sponsor = $6, routing = $7, queued_at = now()
        WHERE id = $1`,
      [
        id,
        input.description,
        input.location,
        input.other,
        challengeId,
        input.preferSponsor,
        routing,
      ],
    );
    await client.query("DELETE FROM help_request_topics WHERE request_id = $1", [id]);
    if (topicIds.length > 0) {
      await client.query(
        "INSERT INTO help_request_topics (request_id, topic_id) SELECT $1, unnest($2::int[])",
        [id, topicIds],
      );
    }
    if (fresh.length > 0) {
      await client.query(
        `INSERT INTO help_request_recipients (request_id, user_id)
         SELECT $1, unnest($2::int[]) ON CONFLICT DO NOTHING`,
        [id, fresh],
      );
      const { rows: names } = await client.query<{ name: string }>(
        `SELECT t.name FROM help_topics t WHERE t.id = ANY($1::int[]) ORDER BY lower(t.name)`,
        [topicIds],
      );
      const topicNames = names.map((n) => n.name);
      await notifyMany(
        client,
        fresh.map((helperId) => ({
          userId: helperId,
          category: HELPDESK_CATEGORY,
          channels: CHANNELS,
          payload: {
            template: topicNames.length === 0 ? "helpdesk.requestOther" : "helpdesk.request",
            vars: { topics: topicNames.join(", "), location: input.location },
            kind: "request_created",
            requestId: id,
          },
        })),
      );
    }
    const changedFields = [
      old.description !== input.description && "description",
      old.location !== input.location && "location",
      old.other !== input.other && "other",
      JSON.stringify(old.topic_ids.map(Number)) !== JSON.stringify(topicIds) && "topicIds",
      (old.challenge_id == null ? null : Number(old.challenge_id)) !== challengeId && "challengeId",
      old.prefer_sponsor !== input.preferSponsor && "preferSponsor",
    ].filter((field): field is string => typeof field === "string");
    await audit(client, {
      actorId: userId,
      entityType: "help_request",
      entityId: id,
      action: "edited",
      after: { changedFields, routing, notified: fresh.length },
    });
    return { side, everyone: [...existing, ...fresh] };
  });
  await announce(id, "open", [...result.side, ...result.everyone]);
  return viewOne(pool, userId, id);
}

interface LockedRequest {
  id: number;
  status: HelpRequestStatus;
  requester_id: number | null;
  repo_id: number | null;
  claimed_by: number | null;
  meeting_mode: MeetingMode | null;
  meeting_location: string | null;
  location: string;
  challenge_id: number | null;
}

async function lockRequest(client: PoolClient, id: number): Promise<LockedRequest> {
  const { rows } = await client.query<LockedRequest>(
    `SELECT id, status, requester_id, repo_id, claimed_by, meeting_mode, meeting_location, location,
            challenge_id
       FROM help_requests WHERE id = $1 FOR UPDATE`,
    [id],
  );
  if (!rows[0]) throw new NotFoundError("Help request not found");
  return rows[0];
}

async function helperName(db: Queryable, userId: number): Promise<string> {
  const { rows } = await db.query<{ name: string }>(
    `SELECT ${DISPLAY_NAME_SQL} AS name FROM users u
       LEFT JOIN user_public_profiles pp ON pp.user_id = u.id WHERE u.id = $1`,
    [userId],
  );
  return rows[0]?.name ?? "";
}

/**
 * H66: exactly one helper wins. The row lock serializes concurrent claims;
 * a retry by the winner (same mode and place) returns the existing claim
 * without another delivery.
 */
export async function claimRequest(
  helperId: number,
  id: number,
  input: ClaimInput,
): Promise<HelpRequestView> {
  const meetingLocation = input.mode === "meet_at" ? input.meetingLocation : null;
  const result = await withTransaction(async (client) => {
    await lockActiveUser(client, helperId);
    if (!(await isActiveHelper(client, helperId))) {
      throw new ForbiddenError("Publish your helper profile before claiming requests", {
        code: ERROR_REASONS.HELPER_NOT_ELIGIBLE,
      });
    }
    const req = await lockRequest(client, id);
    // H65: a helper limited to some challenges cannot see, so cannot claim, others.
    const limit = await challengeLimit(client, helperId);
    if (limit && !(req.challenge_id != null && limit.includes(Number(req.challenge_id)))) {
      throw new NotFoundError("Help request not found");
    }
    if (req.status === "claimed" && Number(req.claimed_by) === helperId) {
      if (req.meeting_mode === input.mode && req.meeting_location === meetingLocation) {
        return null;
      }
      throw new ConflictError(
        "You already claimed this request; release it to change the meeting",
        {
          code: ERROR_REASONS.HELP_REQUEST_ALREADY_CLAIMED,
        },
      );
    }
    if (req.status === "claimed") {
      throw new ConflictError("Another helper already claimed this request", {
        code: ERROR_REASONS.HELP_REQUEST_ALREADY_CLAIMED,
      });
    }
    if (req.status !== "open") {
      throw new ConflictError("This help request is closed", {
        code: ERROR_REASONS.HELP_REQUEST_CLOSED,
      });
    }
    const side = await requestingSide(client, req.requester_id, req.repo_id);
    if (side.includes(helperId) || req.requester_id === helperId) {
      throw new ConflictError("You cannot claim your own request", {
        code: ERROR_REASONS.HELP_REQUEST_NOT_CLAIMABLE,
      });
    }
    await client.query(
      `UPDATE help_requests
          SET status = 'claimed', claimed_by = $2, claimed_at = now(),
              meeting_mode = $3, meeting_location = $4
        WHERE id = $1`,
      [id, helperId, input.mode, meetingLocation],
    );
    const name = await helperName(client, helperId);
    if (side.length > 0) {
      await notifyMany(
        client,
        side.map((userId) => ({
          userId,
          category: HELPDESK_CATEGORY,
          channels: CHANNELS,
          payload: {
            template: input.mode === "meet_at" ? "helpdesk.meetAt" : "helpdesk.onMyWay",
            vars: { helperName: name, meetingLocation, location: req.location },
            kind: "request_claimed",
            requestId: id,
            mode: input.mode,
            meetingLocation,
            helperName: name,
          },
        })),
      );
    }
    await audit(client, {
      actorId: helperId,
      entityType: "help_request",
      entityId: id,
      action: "claimed",
      before: { status: req.status },
      after: { status: "claimed", mode: input.mode },
    });
    return { side, recipients: await recipientIds(client, id) };
  });
  if (result) await announce(id, "claimed", [helperId, ...result.side, ...result.recipients]);
  return viewOne(pool, helperId, id);
}

/** The claimer hands the request back; the requesting side is told. */
export async function releaseRequest(helperId: number, id: number): Promise<HelpRequestView> {
  const result = await withTransaction(async (client) => {
    await lockActiveUser(client, helperId);
    const req = await lockRequest(client, id);
    if (req.status !== "claimed" || Number(req.claimed_by) !== helperId) {
      throw new ConflictError("Only the helper who claimed this request can release it", {
        code: ERROR_REASONS.HELP_REQUEST_NOT_CLAIMER,
      });
    }
    await client.query(
      `UPDATE help_requests
          SET status = 'open', claimed_by = NULL, claimed_at = NULL,
              meeting_mode = NULL, meeting_location = NULL
        WHERE id = $1`,
      [id],
    );
    const side = await requestingSide(client, req.requester_id, req.repo_id);
    if (side.length > 0) {
      await notifyMany(
        client,
        side.map((userId) => ({
          userId,
          category: HELPDESK_CATEGORY,
          channels: CHANNELS,
          payload: {
            template: "helpdesk.released",
            vars: {},
            kind: "request_released",
            requestId: id,
          },
        })),
      );
    }
    await audit(client, {
      actorId: helperId,
      entityType: "help_request",
      entityId: id,
      action: "released",
      before: { status: "claimed" },
      after: { status: "open" },
    });
    return { side, recipients: await recipientIds(client, id) };
  });
  await announce(id, "open", [helperId, ...result.side, ...result.recipients]);
  return viewOne(pool, helperId, id);
}

/** Requesting side withdraws an open or claimed request; a claimer is told. */
export async function cancelRequest(userId: number, id: number): Promise<HelpRequestView> {
  const result = await withTransaction(async (client) => {
    await lockActiveUser(client, userId);
    const req = await lockRequest(client, id);
    const side = await requestingSide(client, req.requester_id, req.repo_id);
    if (!side.includes(userId)) throw new NotFoundError("Help request not found");
    if (req.status !== "open" && req.status !== "claimed") {
      throw new ConflictError("This help request is closed", {
        code: ERROR_REASONS.HELP_REQUEST_CLOSED,
      });
    }
    await client.query(
      "UPDATE help_requests SET status = 'cancelled', cancelled_at = now() WHERE id = $1",
      [id],
    );
    if (req.claimed_by != null) {
      await notifyMany(client, [
        {
          userId: Number(req.claimed_by),
          category: HELPDESK_CATEGORY,
          channels: CHANNELS,
          payload: {
            template: "helpdesk.cancelled",
            vars: {},
            kind: "request_cancelled",
            requestId: id,
          },
        },
      ]).catch((err) => {
        // A claimer removed meanwhile (H54) has nobody to notify.
        if (err instanceof NotFoundError) return [];
        throw err;
      });
    }
    await audit(client, {
      actorId: userId,
      entityType: "help_request",
      entityId: id,
      action: "cancelled",
      before: { status: req.status },
      after: { status: "cancelled" },
    });
    return {
      side,
      others: [
        ...(req.claimed_by != null ? [Number(req.claimed_by)] : []),
        ...(await recipientIds(client, id)),
      ],
    };
  });
  await announce(id, "cancelled", [...result.side, ...result.others]);
  return viewOne(pool, userId, id);
}

/** Claimer or requesting side closes a claimed request as helped. */
export async function resolveRequest(userId: number, id: number): Promise<HelpRequestView> {
  const result = await withTransaction(async (client) => {
    await lockActiveUser(client, userId);
    const req = await lockRequest(client, id);
    const side = await requestingSide(client, req.requester_id, req.repo_id);
    const isClaimer = req.claimed_by != null && Number(req.claimed_by) === userId;
    if (!isClaimer && !side.includes(userId)) throw new NotFoundError("Help request not found");
    if (req.status !== "claimed") {
      throw new ConflictError(
        req.status === "open"
          ? "Only a claimed request can be resolved"
          : "This help request is closed",
        {
          code:
            req.status === "open"
              ? ERROR_REASONS.HELP_REQUEST_NOT_CLAIMED
              : ERROR_REASONS.HELP_REQUEST_CLOSED,
        },
      );
    }
    await client.query(
      "UPDATE help_requests SET status = 'resolved', resolved_at = now() WHERE id = $1",
      [id],
    );
    // H66: progress is delivered transactionally with the state change.
    const targets = [...new Set([...side, Number(req.claimed_by)])].filter(
      (target) => target !== userId,
    );
    if (targets.length > 0) {
      const actorName = await helperName(client, userId);
      await notifyMany(
        client,
        targets.map((target) => ({
          userId: target,
          category: HELPDESK_CATEGORY,
          channels: CHANNELS,
          payload: {
            template: "helpdesk.resolved",
            vars: { actorName },
            kind: "request_resolved",
            requestId: id,
          },
        })),
      );
    }
    await audit(client, {
      actorId: userId,
      entityType: "help_request",
      entityId: id,
      action: "resolved",
      before: { status: "claimed" },
      after: { status: "resolved" },
    });
    return { side, claimer: Number(req.claimed_by) };
  });
  await announce(id, "resolved", [...result.side, result.claimer]);
  return viewOne(pool, userId, id);
}
