import { EVENTS, SSE_TOPICS, type SseEnvelope } from "@hackos/shared/events";
import { AppState, type AppStateStatus, Platform } from "react-native";
import { authClient } from "./auth-client";
import { API_URL } from "./env";

type Listener = (event: SseEnvelope) => void;
const listeners = new Map<string, Set<Listener>>();

export type ServerEventResyncReason = "reconnect" | "gap" | "foreground" | "identity-change";

export type ServerEventResyncContext = {
  reason: ServerEventResyncReason;
  path: string;
  lastEventId: string | null;
};

export type ServerEventStreamOptions = {
  enabled?: boolean;
  identityKey?: string | number | null;
  onResync?: (context: ServerEventResyncContext) => void;
};

export function subscribeToServerEvent(type: string, listener: Listener): () => void {
  const current = listeners.get(type) ?? new Set<Listener>();
  current.add(listener);
  listeners.set(type, current);
  return () => current.delete(listener);
}

function emit(event: SseEnvelope): void {
  for (const listener of listeners.get(event.type) ?? []) listener(event);
}

function emitResync(context: ServerEventResyncContext): void {
  emit({
    type: EVENTS.REALTIME_RESYNC,
    id: context.lastEventId ?? "0",
    at: new Date().toISOString(),
    data: context,
  });
}

function consumeBlock(
  block: string,
  state: {
    lastEventId: number | null;
    ignoreNextGap: boolean;
    path: string;
    onResync?: ServerEventStreamOptions["onResync"];
  },
): void {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return;
  try {
    const envelope = JSON.parse(data) as SseEnvelope;
    if (typeof envelope.type !== "string") return;
    const eventId = Number(envelope.id);
    if (Number.isSafeInteger(eventId)) {
      if (state.lastEventId !== null && eventId !== state.lastEventId + 1 && !state.ignoreNextGap) {
        const context = {
          reason: "gap" as const,
          path: state.path,
          lastEventId: String(state.lastEventId),
        };
        state.onResync?.(context);
        emitResync(context);
      }
      state.ignoreNextGap = false;
      state.lastEventId = eventId;
    }
    emit(envelope);
  } catch {
    // A malformed event is isolated; the next server envelope can still be
    // consumed and the periodic full refetch remains the recovery path.
  }
}

function retryAfter(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

/**
 * Native authenticated SSE loop for a single server-sent-events endpoint.
 * The Better Auth Expo plugin exposes the restored Cookie header, which
 * avoids a browser cookie jar dependency. RN's fetch response body is a
 * readable stream, so no EventSource polyfill is required.
 */
function startEventStream(
  path: string,
  options: boolean | ServerEventStreamOptions = true,
): () => void {
  const normalized = typeof options === "boolean" ? { enabled: options } : options;
  if (normalized.enabled === false || Platform.OS === "web") return () => undefined;
  let stopped = false;
  let controller: AbortController | null = null;
  let reconnect: ReturnType<typeof setTimeout> | null = null;
  let failedConnections = 0;
  let hasOpened = false;
  let ignoreNextGap = false;
  let lastEventId: number | null = null;
  let appIsActive = (AppState?.currentState ?? "active") === "active";

  const connect = async () => {
    if (stopped || !appIsActive) return;
    controller = new AbortController();
    let serverDelay: number | null = null;
    try {
      const headers: Record<string, string> = {
        cookie: authClient.getCookie(),
        accept: "text/event-stream",
      };
      if (lastEventId !== null) headers["last-event-id"] = String(lastEventId);
      const response = await fetch(`${API_URL}${path}`, {
        headers,
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        serverDelay = retryAfter(response);
        throw new Error(`SSE failed (${response.status})`);
      }
      failedConnections = 0;
      if (hasOpened) {
        ignoreNextGap = true;
        const context = {
          reason: "reconnect" as const,
          path,
          lastEventId: lastEventId === null ? null : String(lastEventId),
        };
        normalized.onResync?.(context);
        emitResync(context);
      }
      hasOpened = true;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          consumeBlock(buffer.slice(0, boundary), {
            get lastEventId() {
              return lastEventId;
            },
            set lastEventId(value: number | null) {
              lastEventId = value;
            },
            get ignoreNextGap() {
              return ignoreNextGap;
            },
            set ignoreNextGap(value: boolean) {
              ignoreNextGap = value;
            },
            path,
            onResync: normalized.onResync,
          });
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch (error) {
      if (!stopped && !(error instanceof DOMException && error.name === "AbortError")) {
        // Reconnect below. Screens also retain their bounded polling fallback.
      }
    } finally {
      if (!stopped && appIsActive) {
        const backoff = Math.min(1_000 * 2 ** failedConnections, 30_000);
        failedConnections += 1;
        // Respect the proxy's Retry-After while bounding recovery time.
        const delay = Math.min(serverDelay ?? backoff, 60_000);
        reconnect = setTimeout(() => void connect(), delay);
      }
    }
  };
  const appStateSubscription = AppState?.addEventListener?.("change", (next: AppStateStatus) => {
    const wasActive = appIsActive;
    appIsActive = next === "active";
    if (!appIsActive) {
      if (reconnect) clearTimeout(reconnect);
      reconnect = null;
      controller?.abort();
      return;
    }
    if (!wasActive && hasOpened) {
      const context = {
        reason: "foreground" as const,
        path,
        lastEventId: lastEventId === null ? null : String(lastEventId),
      };
      normalized.onResync?.(context);
      emitResync(context);
    }
    void connect();
  });
  void connect();
  return () => {
    stopped = true;
    appStateSubscription?.remove();
    controller?.abort();
    if (reconnect) clearTimeout(reconnect);
  };
}

/** Native authenticated SSE loop for the personal user topic (H28/H38). */
export function startPersonalEventStream(options: ServerEventStreamOptions = {}): () => void {
  return startEventStream("/api/queue/me/stream", options);
}

/** Native identity stream so role/capability changes revalidate /api/me immediately. */
export function startIdentityEventStream(
  options: boolean | ServerEventStreamOptions = true,
): () => void {
  return startEventStream(`/api/events/stream?topic=${SSE_TOPICS.IDENTITY}`, options);
}

/**
 * Native SSE loop for the shared "queue" topic (H29/H31), which carries
 * operator-facing events like QUEUE_TEAM_CALLED and QUEUE_ENTRY_CHANGED.
 * Unlike the personal stream this is only opened while an operator has the
 * queue-operations screen mounted, not app-wide.
 */
export function startQueueEventStream(
  options: boolean | ServerEventStreamOptions = true,
): () => void {
  return startEventStream("/api/queue/stream", options);
}

/**
 * Native SSE loop for the shared "logistics" topic (H22-H27) — carries
 * accreditation, presence, and activity/meal scan events from every device.
 * The scanner home screen listens on this to refresh its stats tiles the
 * moment another device's scan changes them, instead of polling.
 */
export function startLogisticsEventStream(
  options: boolean | ServerEventStreamOptions = true,
): () => void {
  return startEventStream("/api/logistics/stream", options);
}
