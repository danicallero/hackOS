import type { FastifyRequest } from "fastify";
import client from "prom-client";
import { TooManyRequestsError } from "./errors.js";
import { register } from "./metrics.js";
import { valkey } from "./valkey.js";

/**
 * Shared distributed rate-limit primitive (#538). Fixed-window counter in
 * Valkey (`INCR` + `EXPIRE` on the first hit of a window, capped at `max`),
 * shared across every API replica since the counter lives in Valkey, not
 * process memory. On any Valkey error the request is allowed through
 * (fail-open, per explicit decision on #538: a Valkey outage must not become
 * a full auth/scanner outage) and counted on `hackos_rate_limit_store_errors_total`
 * so ops can see rate limiting is degraded.
 */

export interface RateLimitRule {
  windowSeconds: number;
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

const storeErrors = new client.Counter({
  name: "hackos_rate_limit_store_errors_total",
  help: "Valkey errors while checking a rate limit; the request was allowed through (fail-open) (#538)",
  labelNames: ["bucket"],
  registers: [register],
});

const rejections = new client.Counter({
  name: "hackos_rate_limit_rejections_total",
  help: "Requests rejected by a rate-limit policy, by bucket (#538)",
  labelNames: ["bucket"],
  registers: [register],
});

let storeErrorLogged = false;

export async function consumeRateLimit(
  bucket: string,
  key: string,
  rule: RateLimitRule,
): Promise<RateLimitResult> {
  const redisKey = `ratelimit:${bucket}:${key}`;
  try {
    const count = await valkey.incr(redisKey);
    if (count === 1) {
      await valkey.expire(redisKey, rule.windowSeconds);
    }
    if (count > rule.max) {
      rejections.inc({ bucket });
      const ttl = await valkey.ttl(redisKey);
      return { allowed: false, retryAfterSeconds: ttl > 0 ? ttl : rule.windowSeconds };
    }
    return { allowed: true };
  } catch (err) {
    storeErrors.inc({ bucket });
    if (!storeErrorLogged) {
      // eslint-disable-next-line no-console
      console.error("[rate-limit] Valkey error, failing open", err);
      storeErrorLogged = true;
    }
    return { allowed: true };
  }
}

/** `req.ip` (Fastify already resolves this per `config.trustProxy`). */
export function keyByIp(req: FastifyRequest): string {
  return req.ip;
}

/** Authenticated staff user, falling back to IP if somehow unauthenticated. */
export function keyByUser(req: FastifyRequest): string {
  return req.userId !== null ? `u:${req.userId}` : req.ip;
}

/**
 * Fastify preHandler factory. Compose alongside other preHandlers (capability
 * checks, `idempotencyGuard`) exactly like the rest of this codebase does —
 * e.g. `preHandler: [rateLimitGuard(...), accredit, idempotencyGuard]`.
 */
export function rateLimitGuard(
  bucket: string,
  rule: RateLimitRule,
  keyOf: (req: FastifyRequest) => string,
) {
  return async (req: FastifyRequest): Promise<void> => {
    const result = await consumeRateLimit(bucket, keyOf(req), rule);
    if (!result.allowed) {
      throw new TooManyRequestsError(
        "Too many requests — try again later.",
        result.retryAfterSeconds,
      );
    }
  };
}
