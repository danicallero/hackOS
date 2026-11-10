import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { broadcast } from "../../lib/sse.js";

/** Ids only: open logistics and RSVP panels refetch (plan/07 invariant 5). */
export async function broadcastRsvpSettings(activityIds: number[]): Promise<void> {
  await broadcast(SSE_TOPICS.LOGISTICS, EVENTS.LOGISTICS_RSVP_UPDATED, { activityIds });
}
