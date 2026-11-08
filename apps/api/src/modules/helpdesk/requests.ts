import { ERROR_REASONS } from "@hackos/shared/error-reasons";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type { PoolClient } from "pg";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { afterCommit } from "../../lib/after-commit.js";
import { audit } from "../../lib/audit.js";
import { isUniqueViolation } from "../../lib/db-errors.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { broadcast } from "../../lib/sse.js";
import { hasEventAccess } from "../identity/role.js";
import { type NotifyOptions, notifyMany } from "../notifications/service.js";
import {
  CARD_COLUMNS,
  type CardRow,
  DISPLAY_NAME_SQL,
  type HelperKind,
  type HelpTopic,
  isEligibleHelper,
  LISTED_HELPER_WHERE,
  presentSql,
  scheduledNowSql,
  toCard,
} from "./helpers.js";
import type { ClaimInput, CreateRequestInput } from "./schemas.js";
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
export type RoutingOutcome = "matched" | "fallback" | "none";

export const HELPDESK_CATEGORY = "helpdesk";
const CHANNELS: NotifyOptions["channels"] = ["in_app", "push"];

export interface HelpRequestView {
  id: number;
  status: HelpRequestStatus;
  description: string;
  location: string;
  topics: HelpTopic[];
  other: boolean;
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
      affiliation: string | null;
    } | null;
    mode: MeetingMode;
    meetingLocation: string | null;
    claimedAt: string;
  };
  createdAt: string;
  resolvedAt: string | null;
  cancelledAt: string | null;
  viewer: {
    canCancel: boolean;
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
  topics: HelpTopic[];
  notified_count: number;
  viewer_notified: boolean;
  viewer_on_team: boolean;
}

/** `$1` is always the viewer id. */
function requestSelect(where: string, order: string, limit = 100): string {
  return `
  SELECT hr.id, hr.status, hr.description, hr.location, hr.other, hr.routing,
         hr.requester_id,
         CASE WHEN u.id IS NOT NULL THEN ${DISPLAY_NAME_SQL} END AS requester_name,
         hr.repo_id, rp.name AS repo_name,
         hr.claimed_by, hr.claimed_at, hr.meeting_mode, hr.meeting_location,
         hr.resolved_at, hr.cancelled_at, hr.created_at,
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
                    affiliation: card.affiliation,
                  }
                : null,
              mode: r.meeting_mode,
              meetingLocation: r.meeting_location,
              claimedAt: r.claimed_at.toISOString(),
            }
          : null,
      createdAt: r.created_at.toISOString(),
      resolvedAt: r.resolved_at?.toISOString() ?? null,
      cancelledAt: r.cancelled_at?.toISOString() ?? null,
      viewer: {
        canCancel: active && r.viewer_on_team,
        canClaim: r.status === "open" && viewerIsHelper && !r.viewer_on_team,
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
  const [view] = await toViews(db, rows, await isActiveHelper(db, viewerId), viewerId);
  return view as HelpRequestView;
}

/**
 * Read one request: the requesting side, eligible helpers and coverage
 * readers. Everyone else gets 404, so ids cannot be probed.
 */
export async function getRequest(
  viewerId: number,
  id: number,
  canSeeAll: boolean,
): Promise<HelpRequestView> {
  const view = await viewOne(pool, viewerId, id);
  const onTeam = view.viewer.canCancel || (await onRequestTeam(pool, viewerId, id));
  if (!onTeam && !canSeeAll && !(await isEligibleHelper(pool, viewerId))) {
    throw new NotFoundError("Help request not found");
  }
  return view;
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
  const { rows } = await pool.query<RequestRow>(
    scope === "open"
      ? requestSelect(
          "hr.status = 'open'",
          `EXISTS (SELECT 1 FROM help_request_recipients rr
                    WHERE rr.request_id = hr.id AND rr.user_id = $1) DESC,
           hr.created_at, hr.id`,
        )
      : requestSelect(
          "hr.claimed_by = $1 AND hr.status IN ('claimed', 'resolved')",
          "(hr.status = 'claimed') DESC, hr.claimed_at DESC, hr.id DESC",
          50,
        ),
    [userId],
  );
  return toViews(pool, rows, await isActiveHelper(pool, userId), userId);
}

/** The caller's active project teams, the targets of a team request. */
export async function listMyProjects(userId: number): Promise<{ id: number; name: string }[]> {
  const { rows } = await pool.query<{ id: number; name: string }>(
    `SELECT r.id, r.name FROM submissions s JOIN repos r ON r.id = s.repo_id
      WHERE s.user_id = $1 AND s.status = 'active'
      ORDER BY lower(r.name), r.id`,
    [userId],
  );
  return rows.map((r) => ({ id: Number(r.id), name: r.name }));
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

/** H65 audience at this moment. */
async function routeAudience(
  db: Queryable,
  requesterSide: number[],
  topicIds: number[],
  other: boolean,
): Promise<{ routing: RoutingOutcome; userIds: number[] }> {
  const { rows } = await db.query<{ user_id: number; matches: boolean }>(
    `SELECT u.id AS user_id,
            EXISTS (SELECT 1 FROM helper_topics ht
                     WHERE ht.user_id = u.id AND ht.topic_id = ANY($2::int[])) AS matches
       FROM helper_profiles hp
       JOIN users u ON u.id = hp.user_id
      WHERE ${LISTED_HELPER_WHERE}
        AND ${scheduledNowSql("u.id")}
        AND ${presentSql("u.id")}
        AND NOT (u.id = ANY($1::int[]))
      ORDER BY u.id`,
    [requesterSide, topicIds],
  );
  const matched = rows.filter((r) => r.matches).map((r) => Number(r.user_id));
  if (!other && matched.length > 0) return { routing: "matched", userIds: matched };
  if (rows.length === 0) return { routing: "none", userIds: [] };
  return { routing: "fallback", userIds: rows.map((r) => Number(r.user_id)) };
}

export async function createRequest(
  userId: number,
  input: CreateRequestInput,
): Promise<HelpRequestView> {
  const topicIds = [...new Set(input.topicIds)].sort((a, b) => a - b);
  const result = await withTransaction(async (client) => {
    await lockActiveUser(client, userId);
    if (!(await hasEventAccess(client, userId))) {
      throw new ForbiddenError("The help desk is only available to event attendees");
    }
    const repoId = input.projectId ?? null;
    if (repoId != null) {
      // Lock the project so two members cannot open simultaneous requests.
      const { rows } = await client.query(
        `SELECT 1 FROM repos r
          WHERE r.id = $1 AND EXISTS (SELECT 1 FROM submissions s WHERE s.repo_id = r.id
             AND s.user_id = $2 AND s.status = 'active')
          FOR UPDATE OF r`,
        [repoId, userId],
      );
      if (!rows[0]) throw new ForbiddenError("You are not a member of this project");
    }
    await assertTopicsExist(client, topicIds);
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
    const { routing, userIds } = await routeAudience(client, side, topicIds, input.other);
    let id: number;
    try {
      const { rows } = await client.query<{ id: number }>(
        `INSERT INTO help_requests (requester_id, repo_id, description, location, other, routing)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [userId, repoId, input.description, input.location, input.other, routing],
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
      after: { repoId, topicIds, other: input.other, routing, notified: userIds.length },
    });
    return { id, side, userIds };
  });
  await announce(result.id, "open", [...result.side, ...result.userIds]);
  return viewOne(pool, userId, result.id);
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
}

async function lockRequest(client: PoolClient, id: number): Promise<LockedRequest> {
  const { rows } = await client.query<LockedRequest>(
    `SELECT id, status, requester_id, repo_id, claimed_by, meeting_mode, meeting_location, location
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
