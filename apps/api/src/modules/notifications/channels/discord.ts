import { PermanentDispatchError } from "../errors.js";

/**
 * Discord channel — post-MVP, deliberately not implemented. Any outbox row
 * routed here is parked as `failed` immediately (no retry ladder burned)
 * with a message that says exactly why, so it's obvious in the admin/audit
 * surface that this is a configuration gap, not a transient outage.
 */
export async function dispatchDiscord(): Promise<never> {
  throw new PermanentDispatchError("channel not configured");
}
