import type { SseEnvelope } from "@hackos/shared/events";
import { observePhysicalSseConnection, telemetryScopeForStream } from "./realtime-telemetry";

type Subscriber = {
  events?: readonly string[];
  onConnectionChange?: (connected: boolean) => void;
  onEvent?: (envelope: SseEnvelope) => void;
  onResync?: (context: SseResyncContext) => void;
};

export type SseResyncReason = "reconnect" | "gap" | "identity-change" | "foreground";

export type SseResyncContext = {
  reason: SseResyncReason;
  topic: string;
  lastEventId: string | null;
};

type Stream = {
  connected: boolean;
  source: EventSource;
  subscribers: Set<Subscriber>;
  eventHandlers: Map<string, EventListener>;
  hasOpened: boolean;
  ignoreNextGap: boolean;
  lastEventId: number | null;
};

const streams = new Map<string, Stream>();

function streamKey(url: string): string {
  try {
    const parsed = new URL(
      url,
      typeof window === "undefined" ? "http://sse.invalid" : window.location.origin,
    );
    parsed.searchParams.sort();
    return parsed.toString();
  } catch {
    return url;
  }
}

function parseEnvelope(event: MessageEvent): SseEnvelope | null {
  try {
    return JSON.parse(event.data) as SseEnvelope;
  } catch {
    return null;
  }
}

function topicForUrl(url: string): string {
  try {
    const parsed = new URL(
      url,
      typeof window === "undefined" ? "http://sse.invalid" : window.location.origin,
    );
    return parsed.searchParams.get("topic") ?? parsed.pathname;
  } catch {
    return url;
  }
}

function notifyResync(stream: Stream, reason: SseResyncReason): void {
  const context: SseResyncContext = {
    reason,
    topic: topicForUrl(stream.source.url),
    lastEventId: stream.lastEventId === null ? null : String(stream.lastEventId),
  };
  for (const subscriber of stream.subscribers) subscriber.onResync?.(context);
}

function dispatch(stream: Stream, event: MessageEvent, eventName?: string) {
  const envelope = parseEnvelope(event);
  if (!envelope) return;

  const eventId = Number(envelope.id || event.lastEventId);
  if (Number.isSafeInteger(eventId)) {
    if (
      stream.lastEventId !== null &&
      eventId !== stream.lastEventId + 1 &&
      !stream.ignoreNextGap
    ) {
      notifyResync(stream, "gap");
    }
    stream.ignoreNextGap = false;
    stream.lastEventId = eventId;
  }

  for (const subscriber of stream.subscribers) {
    if (eventName ? subscriber.events?.includes(eventName) : !subscriber.events) {
      subscriber.onEvent?.(envelope);
    }
  }
}

function addNamedEvent(stream: Stream, eventName: string) {
  if (stream.eventHandlers.has(eventName)) return;
  const handler = ((event: MessageEvent) => dispatch(stream, event, eventName)) as EventListener;
  stream.eventHandlers.set(eventName, handler);
  stream.source.addEventListener(eventName, handler);
}

/**
 * Share one physical SSE connection between every subscriber to a stream in a
 * browser tab (H22-H38, H41-H42). The final unsubscribe owns teardown.
 */
export function subscribeToSse(
  url: string,
  subscriber: Subscriber & { identityKey?: string | number | null },
): () => void {
  const key = `${streamKey(url)}::identity=${subscriber.identityKey ?? "anonymous"}`;
  let stream = streams.get(key);
  if (!stream) {
    const source = new EventSource(url, { withCredentials: true });
    stream = {
      connected: false,
      source,
      subscribers: new Set(),
      eventHandlers: new Map(),
      hasOpened: false,
      ignoreNextGap: false,
      lastEventId: null,
    };
    streams.set(key, stream);
    if (telemetryScopeForStream(url)) observePhysicalSseConnection(url, "opened");

    source.onopen = () => {
      if (!stream) return;
      stream.connected = true;
      if (stream.hasOpened) {
        stream.ignoreNextGap = true;
        notifyResync(stream, "reconnect");
      }
      stream.hasOpened = true;
      for (const current of stream.subscribers) current.onConnectionChange?.(true);
    };
    source.onerror = () => {
      if (!stream) return;
      stream.connected = false;
      for (const current of stream.subscribers) current.onConnectionChange?.(false);
    };
    source.onmessage = (event) => dispatch(stream as Stream, event);
  }

  stream.subscribers.add(subscriber);
  subscriber.onConnectionChange?.(stream.connected);
  for (const eventName of subscriber.events ?? []) addNamedEvent(stream, eventName);

  return () => {
    if (!stream?.subscribers.delete(subscriber)) return;
    if (stream.subscribers.size > 0) return;

    for (const [eventName, handler] of stream.eventHandlers) {
      stream.source.removeEventListener(eventName, handler);
    }
    stream.source.close();
    if (telemetryScopeForStream(url)) observePhysicalSseConnection(url, "closed");
    streams.delete(key);
  };
}
