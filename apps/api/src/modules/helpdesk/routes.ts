import { CAPABILITIES } from "@hackos/shared/capabilities";
import { ERROR_REASONS } from "@hackos/shared/error-reasons";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { pool } from "../../db/pool.js";
import {
  assertActiveAuthenticatedUser,
  getRequestAuthorizationContext,
  requireAnyCapability,
  requireAuth,
  requireCapability,
  userHasCapability,
} from "../../lib/capabilities.js";
import { ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { assertFixtureSubjectScope } from "../../lib/fixture-subject-scope.js";
import { idempotencyGuard } from "../../lib/idempotency.js";
import { keyByUser, rateLimitGuard } from "../../lib/rate-limit.js";
import { coverageReport } from "./coverage.js";
import {
  getHelper,
  getMyHelperProfile,
  HELPDESK_BROWSE,
  isEligibleHelper,
  LISTED_HELPER_WHERE,
  listHelpers,
  mayBrowseHelpers,
  mayOpenHelper,
  presentSql,
  replaceMyAvailability,
  updateMyHelperProfile,
} from "./helpers.js";
import {
  cancelRequest,
  claimRequest,
  createRequest,
  editRequest,
  getRequest,
  listInbox,
  listMyRequests,
  listRequestChallenges,
  releaseRequest,
  resolveRequest,
} from "./requests.js";
import { getSchedule, replaceSchedule } from "./schedule.js";
import {
  availabilityBody,
  claimBody,
  coverageQuery,
  createRequestBody,
  editRequestBody,
  helperProfileBody,
  helperQuery,
  idParams,
  inboxQuery,
  mergeBody,
  scheduleBody,
  topicBody,
  topicQuery,
  userParams,
} from "./schemas.js";
import {
  createTopic,
  deleteTopic,
  listManagedTopics,
  mergeTopic,
  renameTopic,
  searchTopics,
} from "./topics.js";

const BROWSE = HELPDESK_BROWSE;

const cap = (
  capability: (typeof CAPABILITIES)[keyof typeof CAPABILITIES],
  edition?: "current" | "global",
) => ({
  routeAccessPolicy: { kind: "capability" as const, capability, edition },
});
const browse = { routeAccessPolicy: { kind: "capability" as const, anyOf: BROWSE } };
const authenticated = { routeAccessPolicy: { kind: "authenticated" as const } };
/** Eligible helpers: `helpdesk:offer` or an accepted helper application (H61). */
const helper = { routeAccessPolicy: { kind: "contextual" as const, policy: "helpdesk-helper" } };
/** Browsers plus eligible helpers who do not hold the capability yet (accepted mentors). */
const catalogue = {
  routeAccessPolicy: { kind: "contextual" as const, policy: "helpdesk-catalogue" },
};
/** The topic catalogue is global: proposing a topic is allowed in any edition. */
const catalogueGlobal = {
  routeAccessPolicy: {
    kind: "contextual" as const,
    policy: "helpdesk-catalogue",
    edition: "global" as const,
  },
};
/** Requesting side, eligible helpers or coverage readers; resolved per request. */
const requestParty = {
  routeAccessPolicy: {
    kind: "contextual" as const,
    policy: "helpdesk-request-party",
    resource: { source: "params" as const, field: "id" },
  },
};

async function requireCatalogueAccess(req: FastifyRequest): Promise<void> {
  await assertActiveAuthenticatedUser(req);
  if (await mayBrowseHelpers(req)) return;
  if (await isEligibleHelper(pool, req.userId as number)) return;
  throw new ForbiddenError(`Missing one of capabilities: ${BROWSE.join(", ")}`, {
    capabilities: BROWSE,
  });
}

/** Only people who can hold a helper profile add knowledge areas (H61). */
async function requireTopicProposer(req: FastifyRequest): Promise<void> {
  await assertActiveAuthenticatedUser(req);
  if (await isEligibleHelper(pool, req.userId as number)) return;
  throw new ForbiddenError("Only people who can offer help may add topics", {
    code: ERROR_REASONS.HELPER_NOT_ELIGIBLE,
  });
}

const topicProposalLimit = rateLimitGuard(
  "helpdesk-topic-proposal",
  { windowSeconds: 60 * 60, max: 20 },
  keyByUser,
);

export function registerHelpdeskRoutes(app: FastifyInstance): void {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // ── H61 knowledge catalogue ────────────────────────────────────────────
  r.get(
    "/api/helpdesk/topics",
    {
      config: catalogue,
      preHandler: requireCatalogueAccess,
      schema: {
        querystring: topicQuery,
        summary: "Search help desk topics",
        description:
          "The shared knowledge catalogue used by helper profiles and help requests (H61). Requesters, and any call with `available=1`, get only the topics offered by published helpers who are in the venue now (H24); eligible helpers and `helpdesk:manage` holders otherwise get the whole catalogue. `q` matches anywhere in the name, ignoring case and accents; exact and prefix matches come first. Other is not a topic: requests carry `other`. Readable with any help desk capability or by an eligible helper (accepted mentor) preparing a profile.",
      },
    },
    async (req) => {
      // Requesters (and any request form) see only what someone in the venue can help with;
      // helpers preparing a profile and managers see the whole catalogue.
      const wholeCatalogue =
        !req.query.available &&
        ((await isEligibleHelper(pool, req.userId as number)) ||
          (await userHasCapability(
            getRequestAuthorizationContext(req),
            CAPABILITIES.HELPDESK_MANAGE,
          )));
      return {
        topics: await searchTopics(
          req.query.q,
          req.query.limit,
          wholeCatalogue ? undefined : `${LISTED_HELPER_WHERE} AND ${presentSql("u.id")}`,
        ),
      };
    },
  );
  r.post(
    "/api/helpdesk/topics",
    {
      config: catalogueGlobal,
      preHandler: [requireTopicProposer, topicProposalLimit, idempotencyGuard],
      schema: {
        body: topicBody,
        summary: "Add a help desk topic",
        description:
          'Adds a missing topic to the shared catalogue (H61), like the university picker. An equivalent name (case, accents and spacing ignored) returns the existing topic with `created: false` and status 200; a new one answers 201. "Other" and its translations are reserved (400 `topic_reserved`). Only people who can have a helper profile (the `eligible` flag of GET /api/me/helper-profile, accepted mentors preparing a profile included) may add topics; everyone else, requesters and managers who are not helpers included, gets 403 `helper_not_eligible`. Audited; 20 proposals per hour per person.',
      },
    },
    async (req, reply) => {
      const result = await createTopic(req.userId as number, req.body.name);
      req.domainUnchanged = !result.created;
      return reply.code(result.created ? 201 : 200).send(result);
    },
  );
  r.get(
    "/api/helpdesk/topics/manage",
    {
      config: cap(CAPABILITIES.HELPDESK_MANAGE),
      preHandler: requireCapability(CAPABILITIES.HELPDESK_MANAGE),
      schema: {
        summary: "List the knowledge catalogue with its usage",
        description:
          "Every help desk topic with `helpers` (profiles that list it) and `requests` (requests about it), for the knowledge areas manager in Libraries (H61). Requires `helpdesk:manage`.",
      },
    },
    async () => ({ topics: await listManagedTopics() }),
  );
  r.delete(
    "/api/helpdesk/topics/:id",
    {
      config: cap(CAPABILITIES.HELPDESK_MANAGE, "global"),
      preHandler: [requireCapability(CAPABILITIES.HELPDESK_MANAGE), idempotencyGuard],
      schema: {
        params: idParams,
        summary: "Delete an unused help desk topic",
        description:
          "Deletes a topic that no helper profile and no request uses (H61); one in use answers 409 `topic_in_use`: merge it into another topic instead. Audited.",
      },
    },
    async (req, reply) => {
      await deleteTopic(req.userId as number, req.params.id);
      return reply.code(204).send();
    },
  );
  r.patch(
    "/api/helpdesk/topics/:id",
    {
      config: cap(CAPABILITIES.HELPDESK_MANAGE, "global"),
      preHandler: [requireCapability(CAPABILITIES.HELPDESK_MANAGE), idempotencyGuard],
      schema: {
        params: idParams,
        body: topicBody,
        summary: "Rename a help desk topic",
        description:
          "Renames a catalogue topic everywhere it is used (H61). A name equivalent to another topic answers 409 `topic_name_taken`: merge them instead. Audited with the old and new name.",
      },
    },
    async (req) => renameTopic(req.userId as number, req.params.id, req.body.name),
  );
  r.post(
    "/api/helpdesk/topics/:id/merge",
    {
      config: cap(CAPABILITIES.HELPDESK_MANAGE, "global"),
      preHandler: [requireCapability(CAPABILITIES.HELPDESK_MANAGE), idempotencyGuard],
      schema: {
        params: idParams,
        body: mergeBody,
        summary: "Merge a duplicate help desk topic",
        description:
          "Moves every helper profile and help request from this topic to `targetId` and deletes this topic (H61). Returns the target. Audited.",
      },
    },
    async (req) => mergeTopic(req.userId as number, req.params.id, req.body.targetId),
  );

  // ── H61/H62 my helper profile ──────────────────────────────────────────
  r.get(
    "/api/me/helper-profile",
    {
      config: authenticated,
      preHandler: requireAuth,
      schema: {
        summary: "Read my helper profile",
        description:
          "The caller's help desk profile (H61, H62): `eligible` (holds `helpdesk:offer`, or has an accepted or confirmed application whose granted role carries it, so accepted mentors can prepare before event access), `published`, the shared public-profile `bio`, `topics`, stated `availability`, `suggestedInterval` (hacking window, else event window, else null: what clients prefill for a new interval), `challengeIds` and `challenges` (the challenges the helper limited their alerts and inbox to, named; empty means every request) with `challengeOptions` (every visible challenge they may pick), and `preview`: exactly what others get from GET /api/helpdesk/helpers/:userId (the card plus `profile`, the public-profile entry honouring the person's switches), even while unpublished; only `profile.cvUrl` is the owner's own route. Answers any signed-in person; non-helpers get `eligible: false` with empty data.",
      },
    },
    async (req) => getMyHelperProfile(req.userId as number),
  );
  r.put(
    "/api/me/helper-profile",
    {
      config: helper,
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        body: helperProfileBody,
        summary: "Update my helper profile",
        description:
          "Publishes or hides the caller's help desk card and replaces its topics (up to 20); optional `challengeIds` (up to 50 visible challenges, else 400; omitted keeps the stored set, `[]` clears it) limits any helper to requests about those challenges; any other field, `bio` included, answers 400: the bio and everything else people see are edited only in the public profile (PUT /api/me/public-profile). Publishing is the consent that shows that public profile to help desk readers; turning it on (unpublished to published) also sets the public profile's `directoryVisible` in the same transaction, and unpublishing does not unshare. 403 `helper_not_eligible` for non-helpers. Audited with field names and topic ids only; repeating the stored values writes nothing (H61).",
      },
    },
    async (req) => {
      const { changed, profile } = await updateMyHelperProfile(req.userId as number, req.body);
      req.domainUnchanged = !changed;
      return profile;
    },
  );
  r.put(
    "/api/me/helper-profile/availability",
    {
      config: helper,
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        body: availabilityBody,
        summary: "Set my help availability",
        description:
          "Replaces the caller's stated availability (H62) with up to 30 dated intervals, each ending after it starts and lasting at most 24 hours, without overlaps, none starting before `suggestedInterval.startsAt` or ending after midnight following the last hacking day in the event timezone (falling back to the event dates; no window, no limit) (400 `availability_invalid` / `availability_overlap` / `availability_before_window`). Being scheduled never marks the person as present: venue presence comes only from door scans (H24). 403 `helper_not_eligible` for non-helpers. Audited with interval counts; successive availability edits coalesce for the same actor and source within two-minute pauses, at most 30 minutes.",
      },
    },
    async (req) => {
      const { changed, profile } = await replaceMyAvailability(req.userId as number, req.body);
      req.domainUnchanged = !changed;
      return profile;
    },
  );

  // ── User management: edit a person's helper profile ───────────────────
  const staffSubject = async (req: FastifyRequest<{ Params: { id: number } }>) => {
    await assertFixtureSubjectScope(pool, req.userId as number, req.params.id);
    return req.params.id;
  };
  r.get(
    "/api/users/:id/helper-profile",
    {
      config: cap(CAPABILITIES.USERS_READ),
      preHandler: requireCapability(CAPABILITIES.USERS_READ),
      schema: {
        params: idParams,
        summary: "Read a person's helper profile",
        description:
          "User management: anyone's help desk profile in the shape of GET /api/me/helper-profile, shared or not. Not audited, like every user-management read. 404 for an unknown or out-of-scope account (H61, H8).",
      },
    },
    async (req) => getMyHelperProfile(await staffSubject(req)),
  );
  r.put(
    "/api/users/:id/helper-profile",
    {
      config: cap(CAPABILITIES.USERS_WRITE),
      preHandler: [requireCapability(CAPABILITIES.USERS_WRITE), idempotencyGuard],
      schema: {
        params: idParams,
        body: helperProfileBody,
        summary: "Edit a person's helper profile",
        description:
          "User management: same body and rules as PUT /api/me/helper-profile (publication, topics, challenge alerts), audited with the acting staff member and source `admin`. 403 `helper_not_eligible` when the person cannot have a helper profile (H61).",
      },
    },
    async (req) => {
      const userId = await staffSubject(req);
      const { changed, profile } = await updateMyHelperProfile(userId, req.body, {
        actorId: req.userId as number,
        source: "admin",
      });
      req.domainUnchanged = !changed;
      return profile;
    },
  );
  r.put(
    "/api/users/:id/helper-profile/availability",
    {
      config: cap(CAPABILITIES.USERS_WRITE),
      preHandler: [requireCapability(CAPABILITIES.USERS_WRITE), idempotencyGuard],
      schema: {
        params: idParams,
        body: availabilityBody,
        summary: "Set a person's help availability",
        description:
          "User management: same body and rules as PUT /api/me/helper-profile/availability, audited with the acting staff member and source `admin` (H62).",
      },
    },
    async (req) => {
      const userId = await staffSubject(req);
      const { changed, profile } = await replaceMyAvailability(userId, req.body, {
        actorId: req.userId as number,
        source: "admin",
      });
      req.domainUnchanged = !changed;
      return profile;
    },
  );

  // ── H64 opening hours ──────────────────────────────────────────────────
  r.get(
    "/api/helpdesk/schedule",
    {
      config: authenticated,
      preHandler: requireAuth,
      schema: {
        summary: "Read the help desk opening hours",
        description:
          "When the help desk accepts new help requests (H64): `configured` (false when no window exists: always open), `open` (now inside a window, server clock; always true when not configured), `windows` sorted by start, `nextChangeAt` (the next window start when closed, the end of the current continuous opening when open, null when it never changes) and `suggestedInterval` (hacking window, else event window, else null: what clients prefill for a new window). Any signed-in person may read it, before or without event access. Only creating requests is gated by it.",
      },
    },
    async () => getSchedule(),
  );
  r.put(
    "/api/helpdesk/schedule",
    {
      config: cap(CAPABILITIES.HELPDESK_MANAGE, "current"),
      preHandler: [requireCapability(CAPABILITIES.HELPDESK_MANAGE), idempotencyGuard],
      schema: {
        body: scheduleBody,
        summary: "Set the help desk opening hours",
        description:
          "Replaces every opening window (H64), and optionally `eventAccessOnly` (omitted keeps it; default true: only people with event access may open a request, false lets any account holding `helpdesk:request` do so), with up to 30 `{ startsAt, endsAt }` instants, each ending after it starts and none overlapping (400); an empty list clears the schedule and the help desk is always open. Outside the windows, creating a request answers 409 `helpdesk_closed`; claims, resolution, browsing helpers, helper settings and existing requests are unaffected. Returns the new schedule as GET /api/helpdesk/schedule. Audited with the old and new windows; repeating the stored windows writes nothing.",
      },
    },
    async (req) => {
      const { changed, schedule } = await replaceSchedule(req.userId as number, req.body);
      req.domainUnchanged = !changed;
      return schedule;
    },
  );

  // ── H63 browse helpers ─────────────────────────────────────────────────
  r.get(
    "/api/helpdesk/helpers",
    {
      config: browse,
      preHandler: requireAnyCapability(...BROWSE),
      schema: {
        querystring: helperQuery,
        summary: "Browse helpers",
        description:
          "Published, eligible helpers (H63): name, photo (when the person's public-profile photo switch is on), headline, bio, kind (`sponsor`, `mentor` or `staff`), sponsor affiliation, topics, stated availability, `scheduledNow`, `present` (latest door scan is an entry, H24) and `availableNow` (both). Filter by `topicId`, free text `q` over names and topics, or `availableNow=true`. Available helpers come first. Browsing creates no diary contact and exposes no other profile data.",
      },
    },
    async (req) => ({ helpers: await listHelpers(req.query) }),
  );
  r.get(
    "/api/helpdesk/helpers/:userId",
    {
      config: browse,
      preHandler: requireAnyCapability(...BROWSE),
      schema: {
        params: userParams,
        summary: "Read a helper",
        description:
          "One published helper (H63): the list card plus `profile`, the person's public profile in exactly the shape of GET /api/directory/:userId (name, photo route, headline, bio, location note, social links, CV route, projects, challenges, help topics), honouring their own public-profile switches (surname, photo, project, CV). Publishing the helper profile is the consent for help desk readers: it needs neither a badge scan nor a visible public profile, and reading it creates no diary contact. `profile.cvUrl` is served to help desk readers too. The requester of a request this helper claimed or resolved can also open them (H64, H66), even if they were unpublished since; knowing an id grants nothing else. Unpublished, ineligible and unknown people all answer 404.",
      },
    },
    async (req) => {
      if (!(await mayOpenHelper(req, pool, req.params.userId))) {
        throw new NotFoundError("Helper not found");
      }
      return getHelper(req.params.userId);
    },
  );

  // ── H64 requests (participant side) ────────────────────────────────────
  r.get(
    "/api/helpdesk/challenges",
    {
      config: cap(CAPABILITIES.HELPDESK_REQUEST),
      preHandler: requireCapability(CAPABILITIES.HELPDESK_REQUEST),
      schema: {
        summary: "List challenges for a help request",
        description:
          "Visible, non-test challenges a help request may be about (H64). Challenges the caller's own projects are queued for come first with `mine: true`; the rest follow by name.",
      },
    },
    async (req) => ({ challenges: await listRequestChallenges(req.userId as number) }),
  );
  r.get(
    "/api/helpdesk/projects",
    {
      config: cap(CAPABILITIES.HELPDESK_REQUEST),
      preHandler: requireCapability(CAPABILITIES.HELPDESK_REQUEST),
      schema: {
        deprecated: true,
        summary: "List teams for a help request (retired)",
        description:
          "Always `{ projects: [] }`. Requests belong to one requester (H64) and there is nothing to choose; the route stays only so installed mobile builds that still ask for the team list open the request form without an error. New clients must not call it.",
      },
    },
    async () => ({ projects: [] }),
  );
  r.post(
    "/api/helpdesk/requests",
    {
      config: cap(CAPABILITIES.HELPDESK_REQUEST),
      preHandler: [requireCapability(CAPABILITIES.HELPDESK_REQUEST), idempotencyGuard],
      schema: {
        body: createRequestBody,
        summary: "Request help",
        description:
          "Opens a help request for the caller, who is always its only requester (H64): a description (≤500), where they are (≤120), up to 5 catalogue topics and/or `other`, optionally `challengeId` (a visible challenge, else 400) and `preferSponsor` (default false, requires a selected challenge). Routing (H65) runs once now, among available present helpers: a helper who limited themselves to some challenges is a candidate only for those challenges; sponsors of the request's challenge match regardless of topic; with `preferSponsor` and at least one available representative of the chosen challenge’s company only those representatives are notified (`routing: sponsor`). Otherwise: published helpers present at the venue (H24; stated intervals are advisory) and know ANY requested topic are notified (`routing: matched`); with Other, or when no such helper matches, every available present helper is (`fallback`); nobody available leaves it open with `none`, still visible in every helper's inbox. Notices go to the inbox and push (category `helpdesk`). One active request per person or team (409 `help_request_active`); 409 `helpdesk_closed` while configured opening hours are closed (H64, GET /api/helpdesk/schedule); 403 without event access or active team membership. Audited.",
      },
    },
    async (req, reply) => reply.code(201).send(await createRequest(req.userId as number, req.body)),
  );
  r.get(
    "/api/helpdesk/requests/mine",
    {
      config: cap(CAPABILITIES.HELPDESK_REQUEST),
      preHandler: requireCapability(CAPABILITIES.HELPDESK_REQUEST),
      schema: {
        summary: "List my help requests",
        description:
          "The caller's own help requests, newest first (latest 50), with the claim and meeting instructions once a helper takes one (H64).",
      },
    },
    async (req) => ({ requests: await listMyRequests(req.userId as number) }),
  );
  r.get(
    "/api/helpdesk/requests/:id",
    {
      config: requestParty,
      preHandler: requireAuth,
      schema: {
        params: idParams,
        summary: "Read a help request",
        description:
          "One help request with its claim and the caller's allowed actions (`viewer`). Readable by the requester, eligible helpers and coverage readers; everyone else gets 404 (H64-H66). `requesterProfile` is the requester's public profile in exactly the shape of GET /api/directory/:userId (photo and CV routes included), returned only to a helper the request was routed to, the helper who claimed it, or `helpdesk:manage`, and only while the requester shares their public profile (`directoryVisible`); otherwise null and the display name stays as in `requester`. Reading it creates no diary contact and exposes no diary or contact data. Helpers limited to some challenges do not see requests about other challenges at all (404).",
      },
    },
    async (req) =>
      getRequest(req.userId as number, req.params.id, {
        canSeeAll: await userHasCapability(
          getRequestAuthorizationContext(req),
          CAPABILITIES.HELPDESK_COVERAGE,
        ),
        canManage: await userHasCapability(
          getRequestAuthorizationContext(req),
          CAPABILITIES.HELPDESK_MANAGE,
        ),
      }),
  );
  r.patch(
    "/api/helpdesk/requests/:id",
    {
      config: requestParty,
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        params: idParams,
        body: editRequestBody,
        summary: "Edit an open help request",
        description:
          "The requester replaces the content of an OPEN request (H64): `description`, `location`, `topicIds`/`other`, `challengeId`, `preferSponsor`, with the same validation as creation (400). The request goes to the end of the first-come, first-served queue (`queuedAt` = now, `queuePosition` recomputed) and is routed again: helpers who newly match are notified, nobody who already received it is notified twice. A claimed request answers 409 `help_request_already_claimed`, a resolved or cancelled one 409 `help_request_closed`; 404 for anyone else. Serialized with claims by a row lock. Audited with the names of the changed fields only.",
      },
    },
    async (req) => editRequest(req.userId as number, req.params.id, req.body),
  );
  r.post(
    "/api/helpdesk/requests/:id/cancel",
    {
      config: requestParty,
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        params: idParams,
        summary: "Cancel a help request",
        description:
          "The requester withdraws an open or claimed request; its status becomes `cancelled` and the audited record remains in history. A claiming helper is notified. 409 `help_request_closed` once resolved or cancelled; 404 for anyone else (H64).",
      },
    },
    async (req) => cancelRequest(req.userId as number, req.params.id),
  );

  // ── H65/H66 helper side ────────────────────────────────────────────────
  r.get(
    "/api/helpdesk/inbox",
    {
      config: helper,
      preHandler: requireAuth,
      schema: {
        querystring: inboxQuery,
        summary: "List help requests for helpers",
        description:
          "`scope=open`: every open request (only those about their chosen challenges for a helper who limited themselves) in first-come, first-served order (`queuedAt`, then id; editing a request sends it to the end), with `viewer.notified` marking the ones routed to the caller; `scope=mine`: requests the caller claimed (claimed, then resolved). 403 `helper_not_eligible` for non-helpers (H65, H66).",
      },
    },
    async (req) => ({ requests: await listInbox(req.userId as number, req.query.scope) }),
  );
  r.post(
    "/api/helpdesk/requests/:id/claim",
    {
      config: helper,
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        params: idParams,
        body: claimBody,
        summary: "Claim a help request",
        description:
          "A published helper takes an open request and tells the requester either `on_my_way` (to their stated location) or `meet_at` a `meetingLocation` (≤120). Concurrent claims are serialized: exactly one wins and the others get 409 `help_request_already_claimed`. A retry by the winner with the same meeting returns the claim without notifying again; to change the meeting, release and claim again. Own requests answer 409 `help_request_not_claimable`. Audited (H66).",
      },
    },
    async (req) => claimRequest(req.userId as number, req.params.id, req.body),
  );
  r.post(
    "/api/helpdesk/requests/:id/release",
    {
      config: helper,
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        params: idParams,
        summary: "Release a claimed help request",
        description:
          "The claiming helper hands the request back to open; the requester is notified and the original audience is not notified again. 409 `help_request_not_claimer` for anyone else or a request that is not claimed. Audited (H66).",
      },
    },
    async (req) => releaseRequest(req.userId as number, req.params.id),
  );
  r.post(
    "/api/helpdesk/requests/:id/resolve",
    {
      config: requestParty,
      preHandler: [requireAuth, idempotencyGuard],
      schema: {
        params: idParams,
        summary: "Mark a help request as solved",
        description:
          "The claimer or the requester closes a claimed request as solved. 409 `help_request_not_claimed` while open and `help_request_closed` once closed; 404 for anyone else. Audited (H66).",
      },
    },
    async (req) => resolveRequest(req.userId as number, req.params.id),
  );

  // ── H67 coverage ───────────────────────────────────────────────────────
  r.get(
    "/api/helpdesk/coverage",
    {
      config: cap(CAPABILITIES.HELPDESK_COVERAGE),
      preHandler: requireCapability(CAPABILITIES.HELPDESK_COVERAGE),
      schema: {
        querystring: coverageQuery,
        summary: "Read help desk coverage",
        description:
          "Published helpers' stated availability across the event (H67): per slot of `stepMinutes` (15-240, default 60) between `from` and `to` (default the event window, else the span of all intervals, with a default `from` floored and `to` ceiled to step boundaries in UTC so slots read 17:00–18:00; explicit values are kept as given; at most 500 slots), how many are scheduled, by kind, and per topic. `now` separates scheduled helpers from those actually inside the venue (H24 presence) and those both (`available`); `uncoveredTopics` lists topics of open requests with no available helper now. Mentors, sponsors and staff all count.",
      },
    },
    async (req) => coverageReport(req.query),
  );
}
