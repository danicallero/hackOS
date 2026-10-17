import { domainScope, EVENTS, REALTIME_SCOPES } from "@hackos/shared/events";
import { useCallback, useEffect, useRef } from "react";
import {
  isServerEventConnected,
  startDomainEventStream,
  startPublicContentEventStream,
  subscribeToServerEvent,
} from "./server-events";

/** Phones refetch spread over this window, so the server's shared cache answers all but the first. */
export const STREAM_REFRESH_JITTER_MS = 3_000;

export interface StreamRefreshOptions {
  /** Payload-free `public-content` invalidations: schedule, announcements, sponsors, challenges, winners. */
  publicContent?: boolean;
  /** Domain topics (`SSE_TOPICS`) whose `domain.changed` signals should refresh the view. */
  domains?: readonly string[];
  enabled?: boolean;
  jitterMs?: number;
}

/**
 * Refreshes a shared read model from the payload-free SSE signals instead of
 * polling. Any signal (or a resync after a reconnect) schedules one `refresh`
 * after a random delay. Returns a stable `streamDown` check for `pollWhen`, so
 * a fallback poll only runs while a subscribed stream is disconnected.
 */
export function useStreamRefresh(
  refresh: () => void,
  {
    publicContent = false,
    domains = [],
    enabled = true,
    jitterMs = STREAM_REFRESH_JITTER_MS,
  }: StreamRefreshOptions = {},
): () => boolean {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const domainsKey = domains.join(",");
  const scopes = useCallback(
    () => [
      ...(publicContent ? [REALTIME_SCOPES.PUBLIC_CONTENT] : []),
      ...(domainsKey ? domainsKey.split(",").map(domainScope) : []),
    ],
    [domainsKey, publicContent],
  );
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        refreshRef.current();
      }, Math.random() * jitterMs);
    };
    const stops: (() => void)[] = [];
    if (publicContent) {
      stops.push(
        startPublicContentEventStream({ onResync: schedule }),
        subscribeToServerEvent(EVENTS.DATA_CHANGED, schedule, REALTIME_SCOPES.PUBLIC_CONTENT),
      );
    }
    for (const topic of domainsKey ? domainsKey.split(",") : []) {
      stops.push(
        startDomainEventStream(topic, { onResync: schedule }),
        subscribeToServerEvent(EVENTS.DOMAIN_CHANGED, schedule, domainScope(topic)),
      );
    }
    return () => {
      if (timer) clearTimeout(timer);
      for (const stop of stops) stop();
    };
  }, [domainsKey, enabled, jitterMs, publicContent]);
  return useCallback(() => scopes().some((scope) => !isServerEventConnected(scope)), [scopes]);
}
