"use client";

import type { SseEnvelope } from "@hackos/shared/events";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { API_URL } from "@/lib/env";
import {
  type SseResyncContext,
  type SseResyncReason,
  sseIdentitySnapshot,
  subscribeSseIdentity,
  subscribeToSse,
} from "@/lib/sse-broker";

/**
 * SSE consumption for the queue/judging vertical (H38, H41-H42). The server
 * frames events per `packages/shared/src/events.ts`: each message is one
 * `SseEnvelope` ({ type, id, at, data }) with the envelope `type` as the SSE
 * event name. Clients refetch their read model on matching server events; the
 * payload is a signal, not full state (see plan §4).
 *
 * The shared fetch reader sends credentials for cookie-authenticated scopes
 * and honors server retry hints across reconnections.
 */

export type { SseEnvelope } from "@hackos/shared/events";

interface UseEventSourceOptions {
  /** Event names to listen for; omit to catch every message via `onmessage`. */
  events?: readonly string[];
  /** Called for each matching envelope. Keep it stable or it re-subscribes. */
  onEvent?: (envelope: SseEnvelope) => void;
  /** Set false to not open the connection (e.g. before an id is known). */
  enabled?: boolean;
  /** Stable identity owning this stream; changes force the old stream closed. */
  identityKey?: string | number | null;
  /** Called when the lossy stream needs an authoritative read-model refetch. */
  onResync?: (context: SseResyncContext) => void;
}

/**
 * Subscribe to a `REALTIME_SCOPES` scope (#892) and dispatch envelopes by name.
 * Returns the live connection state for optional "reconnecting…" UI.
 */
export function useEventSource(
  scope: string,
  { events, onEvent, enabled = true, identityKey = null, onResync }: UseEventSourceOptions = {},
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const sessionIdentity = useSyncExternalStore(
    subscribeSseIdentity,
    sseIdentitySnapshot,
    () => null,
  );
  // Keep the latest callback without forcing a resubscribe every render.
  // Assigned in useEffect to comply with react-hooks/rules-of-hooks.
  const onEventRef = useRef(onEvent);
  const onResyncRef = useRef(onResync);
  const hasPreviousIdentityKey = useRef(false);
  const previousIdentityKey = useRef<string | number | null>(null);
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);
  useEffect(() => {
    onResyncRef.current = onResync;
  }, [onResync]);

  const eventsKey = events ? events.join(",") : "";

  useEffect(() => {
    // SSR and lightweight component-test environments do not provide the
    // browser window. There is no stream to subscribe to in
    // either case; the next mounted browser session performs the normal sync.
    if (!enabled || !scope || typeof window === "undefined") return;

    const names = eventsKey ? eventsKey.split(",") : null;
    const unsubscribe = subscribeToSse(scope, API_URL, {
      events: names ?? undefined,
      onConnectionChange: setConnected,
      onEvent: (envelope) => onEventRef.current?.(envelope),
      onResync: (context) => onResyncRef.current?.(context),
      identityKey: sessionIdentity,
    });

    if (hasPreviousIdentityKey.current && previousIdentityKey.current !== identityKey) {
      onResyncRef.current?.({
        reason: "identity-change" satisfies SseResyncReason,
        topic: scope,
        lastEventId: null,
      });
    }
    hasPreviousIdentityKey.current = true;
    previousIdentityKey.current = identityKey;

    return () => {
      unsubscribe();
      setConnected(false);
    };
  }, [scope, enabled, eventsKey, identityKey, sessionIdentity]);

  return { connected };
}
