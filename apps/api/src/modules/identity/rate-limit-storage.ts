import { consumeRateLimit } from "../../lib/rate-limit.js";
import { valkey } from "../../lib/valkey.js";

/**
 * Local copy of `@better-auth/core`'s `BetterAuthRateLimitStorage` shape.
 * That type isn't reachable from a direct import here (`@better-auth/core`
 * is a transitive dependency of `better-auth`, not one of this package's own
 * `dependencies`) — `betterAuth()`'s own option typing structurally checks
 * this object at the `auth.ts` call site regardless.
 */
export interface RateLimitRecord {
  key: string;
  count: number;
  lastRequest: number;
}
export interface BetterAuthRateLimitStorage {
  get: (key: string) => Promise<RateLimitRecord | null | undefined>;
  set: (key: string, value: RateLimitRecord, update?: boolean) => Promise<void>;
  consume: (
    key: string,
    rule: { window: number; max: number },
  ) => Promise<{ allowed: boolean; retryAfter: number | null }>;
}

/**
 * Distributed storage for Better Auth's own rate limiter (#538), covering
 * every /api/auth/* path (login, sign-up, password reset, email
 * verification — see auth.ts's `rateLimit` option). Delegates the atomic
 * `consume` step to the same Valkey fixed-window primitive the rest of the
 * app's rate limiting uses (`lib/rate-limit.ts`), so it shares that
 * primitive's fail-open behavior on a Valkey outage and its
 * `hackos_rate_limit_*` metrics.
 *
 * `get`/`set` only exist to satisfy `BetterAuthRateLimitStorage` — Better
 * Auth prefers the atomic `consume` when present and never calls `get`/`set`
 * in that path (see better-auth/dist/api/rate-limiter/index.mjs,
 * `onRequestRateLimit`).
 */
export const valkeyRateLimitStorage: BetterAuthRateLimitStorage = {
  get: async (key) => {
    const raw = await valkey.get(`ratelimit:betterauth:data:${key}`);
    return raw ? JSON.parse(raw) : null;
  },
  set: async (key, value) => {
    await valkey.set(`ratelimit:betterauth:data:${key}`, JSON.stringify(value), "EX", 3600);
  },
  consume: async (key, rule) => {
    const result = await consumeRateLimit("betterauth", key, {
      windowSeconds: rule.window,
      max: rule.max,
    });
    return { allowed: result.allowed, retryAfter: result.retryAfterSeconds ?? null };
  },
};
