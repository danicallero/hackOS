import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { httpRequestsInFlight, observeHttpRequest, observeHttpResponse } from "./metrics.js";
import { RequestAdmission, type RequestAdmissionLease } from "./request-admission.js";
import { classifyRequestLane, isSseRequest } from "./request-lanes.js";
import { isProbePath, pathOf } from "./request-path.js";
import { findReviewFixtureByUserId } from "./review-fixture-log.js";
import { broadcast } from "./sse.js";
import {
  directoryMutationForPath,
  mutationDomainForPath,
  publicContentMutationForPath,
} from "./sse-routing.js";

function logSoftFailure(req: FastifyRequest, err: unknown, message: string): void {
  req.log.warn({ err, method: req.method, url: req.url }, message);
}

declare module "fastify" {
  interface FastifyInstance {
    /** Process-local admission gate, read by `/readyz` (#544, #1367). */
    requestAdmission: RequestAdmission;
  }
}

/** Per-request admission and in-flight bookkeeping (#891, #1367). */
interface AdmissionState {
  admissionAbort: AbortController;
  /** Set once the request is counted in `hackos_http_requests_in_flight`. */
  startedAt?: bigint;
  inFlightReleased: boolean;
  /** The client connection closed before a response finished. */
  closed: boolean;
  lease?: RequestAdmissionLease;
}

/**
 * #1367: an earlier async onRequest hook (the auth-context session lookup)
 * can still be running when the client disconnects, so `close` may already
 * have fired before this hook attaches its listener. Read the socket state
 * directly instead of relying on hook order.
 */
function connectionClosed(req: FastifyRequest, reply: FastifyReply): boolean {
  return reply.raw.destroyed === true || req.raw.socket?.destroyed === true;
}

/** In-process admission gate plus HTTP request metrics (H29, H38, #540, #544, #891, #1367). */
export function registerAdmissionHooks(app: FastifyInstance): void {
  const states = new WeakMap<FastifyRequest, AdmissionState>();
  const leaseRequests = new WeakMap<RequestAdmissionLease, FastifyRequest>();
  const stateOf = (req: FastifyRequest): AdmissionState => {
    let state = states.get(req);
    if (!state) {
      state = { admissionAbort: new AbortController(), inFlightReleased: false, closed: false };
      states.set(req, state);
    }
    return state;
  };
  const releaseAdmission = (state: AdmissionState) => {
    const lease = state.lease;
    state.lease = undefined;
    lease?.release();
  };
  const releaseInFlight = (state: AdmissionState) => {
    if (state.startedAt === undefined || state.inFlightReleased) return;
    state.inFlightReleased = true;
    httpRequestsInFlight.dec();
  };
  // #891: an aborted response has no final HTTP status to count, but must
  // still release its admission slot and in-flight gauge exactly once.
  const abandon = (req: FastifyRequest) => {
    const state = stateOf(req);
    if (state.closed) return;
    state.closed = true;
    state.admissionAbort.abort();
    releaseAdmission(state);
    releaseInFlight(state);
  };

  // Event-day admission is deliberately a separate, in-process scheduler
  // from #540's pg pool and SSE budgets. It derives its ceiling from the
  // existing per-process pool size without changing that configuration and
  // reserves slots for P0/P1 operational traffic when participant/public
  // requests surge (H29, H38, H41-H42, #540, #544).
  const requestAdmission = new RequestAdmission({
    maxConcurrent: config.dbPoolMax,
    maxBestEffortPending: Math.max(16, config.dbPoolMax * 8),
    maxHoldMs: config.REQUEST_ADMISSION_MAX_HOLD_MS,
    onLeaseExpired: (lease) => {
      const req = leaseRequests.get(lease);
      if (!req) return;
      const state = states.get(req);
      if (state) {
        if (state.lease === lease) state.lease = undefined;
        // A request this old is either a leak or far beyond any legitimate
        // finite request: stop counting it in flight as well. Its response
        // metric is still recorded if it ever completes (#1367).
        releaseInFlight(state);
      }
      // Route template only: never the raw URL, query string or identity.
      req.log.warn(
        {
          method: req.method,
          route: req.routeOptions.url ?? "unmatched",
          lane: lease.lane,
          maxHoldMs: config.REQUEST_ADMISSION_MAX_HOLD_MS,
        },
        "admission lease force-released after maximum hold time",
      );
    },
  });
  app.decorate("requestAdmission", requestAdmission);

  // Fastify attaches this listener before any onRequest hook runs, so it
  // sees a disconnect whichever hook is awaiting at the time (#1367).
  app.addHook("onRequestAbort", async (req) => abandon(req));

  app.addHook("onRequest", async (req, reply) => {
    const state = stateOf(req);
    const requestPath = pathOf(req.url);
    const isSessionProbe = requestPath === "/api/auth/get-session";
    const lane = classifyRequestLane({ url: req.url, method: req.method, userId: req.userId });
    observeHttpRequest(lane, req.method);
    // #1367: never count or admit a request whose client is already gone.
    // Nothing can receive its response, and a handler writing to a dead
    // socket never reaches onResponse, so stop the lifecycle here.
    if (state.closed || connectionClosed(req, reply)) {
      state.closed = true;
      reply.hijack();
      return;
    }
    if (!isSseRequest(req.url)) {
      state.startedAt = process.hrtime.bigint();
      httpRequestsInFlight.inc();
      reply.raw.once("close", () => {
        if (reply.raw.writableFinished) return;
        abandon(req);
      });
    }
    // A long-lived SSE socket must never hold an admission slot for its whole
    // lifetime. The connection budget/backpressure contract remains entirely
    // owned by sse.ts (#540).
    if (isSseRequest(req.url) || isProbePath(requestPath) || isSessionProbe) {
      return;
    }
    // Admission must not perform a DB lookup before the gate: a burst of
    // authenticated requests could otherwise consume the same pool slots that
    // the gate is meant to protect. Lane classification already keeps P0/P1
    // operational work ahead of the reserved P2/P3 share; authorization still
    // runs in the route handler.
    const lease = await requestAdmission.acquire(lane, state.admissionAbort.signal);
    // The connection may have closed while this request awaited admission.
    if (state.closed || connectionClosed(req, reply)) {
      lease.release();
      abandon(req);
      reply.hijack();
      return;
    }
    state.lease = lease;
    leaseRequests.set(lease, req);
    if (
      req.userId != null &&
      !isSessionProbe &&
      config.REVIEW_FIXTURE_PASSWORD &&
      config.REVIEW_FIXTURE_DELETION_PIN
    ) {
      try {
        req.reviewFixtureContext = await findReviewFixtureByUserId(pool, req.userId);
      } catch {
        // Reviewer diagnostics must never turn an otherwise valid request into
        // a failure when the optional lookup is unavailable.
        req.reviewFixtureContext = null;
      }
    }
  });

  const releaseRequestAdmission = (req: FastifyRequest) => {
    const state = states.get(req);
    if (state) releaseAdmission(state);
  };
  app.addHook("onResponse", async (req) => releaseRequestAdmission(req));
  app.addHook("onError", async (req) => releaseRequestAdmission(req));

  const finishHttpRequest = (req: FastifyRequest, statusCode: number) => {
    const state = states.get(req);
    if (state?.startedAt === undefined || state.closed) return;
    releaseInFlight(state);
    const lane = classifyRequestLane({ url: req.url, method: req.method, userId: req.userId });
    const route = req.routeOptions.url ?? "unmatched";
    const durationSeconds = Number(process.hrtime.bigint() - state.startedAt) / 1_000_000_000;
    observeHttpResponse(lane, req.method, route, statusCode, durationSeconds);
  };
  app.addHook("onResponse", async (req, reply) => finishHttpRequest(req, reply.statusCode));
  // #891: onError runs before the error handler chooses the final status.
  // Record completed responses only in onResponse, including handled errors.
}

/** Reviewer-fixture request trace (H54). */
export function registerReviewFixtureLogHook(app: FastifyInstance): void {
  app.addHook("onResponse", async (req, reply) => {
    const fixture = req.reviewFixtureContext;
    const path = pathOf(req.url);
    if (!fixture || !path.startsWith("/api/")) return;
    const route = req.routeOptions.url ?? path;

    // Keep reviewer diagnostics visible in production even when the normal
    // debug level is disabled: INFO is the transport level, while kind marks
    // this deliberately bounded synthetic-account trace. Never log query
    // strings, request bodies, cookies or credentials.
    req.log.info(
      {
        kind: "DEBUG",
        reviewFixture: true,
        fixtureKey: fixture.fixtureKey,
        userId: fixture.userId,
        email: fixture.email,
        method: req.method,
        path: route,
        statusCode: reply.statusCode,
        ip: req.ip,
        originatingIp: req.ip,
      },
      "review fixture API operation",
    );
  });
}

/** Payload-free refresh broadcasts after successful mutations (H53, #533). */
export function registerMutationRefreshHook(app: FastifyInstance): void {
  app.addHook("onResponse", async (req, reply) => {
    // Browser diagnostics are intentionally not a domain mutation: emitting
    // an audit refresh for every observation would amplify the storm it is
    // measuring (H53, #544).
    if (pathOf(req.url).startsWith("/api/telemetry/")) return;
    if (
      !["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ||
      reply.statusCode >= 300 ||
      req.idempotency?.replayed ||
      req.domainUnchanged
    )
      return;

    // H53 has its own refresh topic. Domain services remain responsible for
    // richer operational events, while this hook covers simple CRUD read
    // models that have no other realtime contract (H7-H55, issue #533).
    const topics = new Set<string>([SSE_TOPICS.AUDIT]);
    const domain = mutationDomainForPath(req.url);
    if (domain) topics.add(domain);
    if (directoryMutationForPath(req.url)) topics.add(SSE_TOPICS.DIRECTORY);
    const broadcasts = [...topics].map((topic) => broadcast(topic, EVENTS.DOMAIN_CHANGED, {}));
    if (publicContentMutationForPath(req.url)) {
      broadcasts.push(broadcast(SSE_TOPICS.PUBLIC_CONTENT, EVENTS.DATA_CHANGED, {}));
      // TV walls render the same public sponsor/challenge projection as
      // content-only clients, but hold only the public-TV socket.
      broadcasts.push(broadcast(SSE_TOPICS.PUBLIC_TV, EVENTS.DATA_CHANGED, {}));
    }
    await Promise.all(broadcasts).catch((err) =>
      logSoftFailure(req, err, "scoped SSE refresh failed"),
    );
  });
}
