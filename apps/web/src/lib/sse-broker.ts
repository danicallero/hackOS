import type { SseEnvelope } from "@hackos/shared/events";
import { observePhysicalSseConnection, telemetryScopeForStream } from "./realtime-telemetry";

type Subscriber = {
  events?: readonly string[];
  onConnectionChange: (connected: boolean) => void;
  onEvent?: (envelope: SseEnvelope) => void;
};

type Stream = {
  connected: boolean;
  source: EventSource;
  subscribers: Set<Subscriber>;
  eventHandlers: Map<string, EventListener>;
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

function dispatch(stream: Stream, event: MessageEvent, eventName?: string) {
  const envelope = parseEnvelope(event);
  if (!envelope) return;

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
export function subscribeToSse(url: string, subscriber: Subscriber): () => void {
  const key = streamKey(url);
  let stream = streams.get(key);
  if (!stream) {
    const source = new EventSource(url, { withCredentials: true });
    stream = {
      connected: false,
      source,
      subscribers: new Set(),
      eventHandlers: new Map(),
    };
    streams.set(key, stream);
    if (telemetryScopeForStream(url)) observePhysicalSseConnection(url, "opened");

    source.onopen = () => {
      if (!stream) return;
      stream.connected = true;
      for (const current of stream.subscribers) current.onConnectionChange(true);
    };
    source.onerror = () => {
      if (!stream) return;
      stream.connected = false;
      for (const current of stream.subscribers) current.onConnectionChange(false);
    };
    source.onmessage = (event) => dispatch(stream as Stream, event);
  }

  stream.subscribers.add(subscriber);
  subscriber.onConnectionChange(stream.connected);
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
