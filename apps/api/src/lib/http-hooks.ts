import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import type { FastifyInstance, FastifyRequest } from "fastify";
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

/** In-process admission gate plus HTTP request metrics (H29, H38, #540, #544, #891). */
export function registerAdmissionHooks(app: FastifyInstance): void {
  // Event-day admission is deliberately a separate, in-process scheduler
  // from #540's pg pool and SSE budgets. It derives its ceiling from the
  // existing per-process pool size without changing that configuration and
  // reserves slots for P0/P1 operational traffic when participant/public
  // requests surge (H29, H38, H41-H42, #540, #544).
  const requestAdmission = new RequestAdmission({
    maxConcurrent: config.dbPoolMax,
    maxBestEffortPending: Math.max(16, config.dbPoolMax * 8),
  });
  const admissionLeases = new WeakMap<FastifyRequest, RequestAdmissionLease>();
  const requestStartedAt = new WeakMap<FastifyRequest, bigint>();
  const finishedRequests = new WeakSet<FastifyRequest>();

  app.addHook("onRequest", async (req, reply) => {
    const admissionAbort = new AbortController();
    const requestPath = pathOf(req.url);
    const isSessionProbe = requestPath === "/api/auth/get-session";
    const lane = classifyRequestLane({ url: req.url, method: req.method, userId: req.userId });
    observeHttpRequest(lane, req.method);
    if (!isSseRequest(req.url)) {
      requestStartedAt.set(req, process.hrtime.bigint());
      httpRequestsInFlight.inc();
      // #891: an aborted response has no final HTTP status to count, but
      // must still release its admission slot and in-flight gauge once.
      reply.raw.once("close", () => {
        if (reply.raw.writableFinished) return;
        admissionAbort.abort();
        releaseAdmission(req);
        finishHttpRequest(req);
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
    const lease = await requestAdmission.acquire(lane, admissionAbort.signal);
    // The connection may have closed while this request awaited admission.
    if (finishedRequests.has(req)) {
      lease.release();
      return;
    }
    admissionLeases.set(req, lease);
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

  const releaseAdmission = (req: FastifyRequest) => {
    const lease = admissionLeases.get(req);
    if (!lease) return;
    lease.release();
    admissionLeases.delete(req);
  };
  app.addHook("onResponse", async (req) => releaseAdmission(req));
  app.addHook("onError", async (req) => releaseAdmission(req));

  const finishHttpRequest = (req: FastifyRequest, statusCode?: number) => {
    if (finishedRequests.has(req)) return;
    const startedAt = requestStartedAt.get(req);
    if (!startedAt) return;
    finishedRequests.add(req);
    httpRequestsInFlight.dec();
    if (statusCode === undefined) return;
    const lane = classifyRequestLane({ url: req.url, method: req.method, userId: req.userId });
    const route = req.routeOptions.url ?? "unmatched";
    const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
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
