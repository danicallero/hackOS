import { valkey } from "../../lib/valkey.js";

/**
 * H3: resend verification is capped at 3/hour AND 60s between attempts,
 * enforced in Valkey (not the DB) so it's cheap and shared across API
 * instances. Two independent gates:
 *  - a 60s cooldown key (SET ... EX 60) that must NOT already exist
 *  - an hourly counter (INCR + EXPIRE on first increment) capped at 3
 * Whichever gate is hit first reports how long until the caller may retry.
 */

const COOLDOWN_SECONDS = 60;
const WINDOW_SECONDS = 3600;
const MAX_PER_WINDOW = 3;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

export async function checkResendVerificationRateLimit(email: string): Promise<RateLimitResult> {
  const normalized = email.trim().toLowerCase();
  const cooldownKey = `identity:verify-resend:cooldown:${normalized}`;
  const countKey = `identity:verify-resend:count:${normalized}`;

  const cooldownTtl = await valkey.ttl(cooldownKey);
  if (cooldownTtl > 0) {
    return { allowed: false, retryAfterSeconds: cooldownTtl };
  }

  const count = await valkey.incr(countKey);
  if (count === 1) {
    await valkey.expire(countKey, WINDOW_SECONDS);
  }
  if (count > MAX_PER_WINDOW) {
    const windowTtl = await valkey.ttl(countKey);
    return { allowed: false, retryAfterSeconds: windowTtl > 0 ? windowTtl : WINDOW_SECONDS };
  }

  await valkey.set(cooldownKey, "1", "EX", COOLDOWN_SECONDS);
  return { allowed: true };
}
