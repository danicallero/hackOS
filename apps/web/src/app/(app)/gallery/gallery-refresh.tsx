"use client";

import { domainScope, EVENTS, REALTIME_SCOPES, SSE_TOPICS } from "@hackos/shared/events";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { PUBLIC_REFRESH_JITTER_MS } from "@/hooks/refresh-jitter";
import { useEventSource } from "@/hooks/use-event-source";
import { useJitteredCallback } from "@/hooks/use-jittered-callback";

/**
 * H17/H60: re-evaluate server projections after reveals, consent changes and
 * project edits. Driven only by the payload-free streams (and their resync
 * after a reconnect or long background); the server answers the refetches
 * from its shared gallery cache.
 */
export function GalleryRefresh() {
  const router = useRouter();
  const refreshNow = useCallback(() => router.refresh(), [router]);
  const refresh = useJitteredCallback(refreshNow, PUBLIC_REFRESH_JITTER_MS);
  useEventSource(REALTIME_SCOPES.PUBLIC_CONTENT, {
    events: [EVENTS.DATA_CHANGED],
    onEvent: refresh,
    onResync: refresh,
  });
  useEventSource(domainScope(SSE_TOPICS.PROJECTS), {
    events: [EVENTS.DOMAIN_CHANGED],
    onEvent: refresh,
    onResync: refresh,
  });
  useEventSource(domainScope(SSE_TOPICS.DIRECTORY), {
    events: [EVENTS.DOMAIN_CHANGED],
    onEvent: refresh,
    onResync: refresh,
  });
  return null;
}
