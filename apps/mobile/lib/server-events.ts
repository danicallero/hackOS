import { EVENTS, REALTIME_SCOPES, type SseEnvelope } from "@hackos/shared/events";
import { RealtimeClient, type ResyncReason } from "@hackos/shared/realtime-client";
import { AppState, Platform } from "react-native";
import { authClient } from "./auth-client";
import { API_URL, onApiUrlChange } from "./env";

export type ServerEventResyncReason = ResyncReason;
export type ServerEventResyncContext = {
  reason: ResyncReason;
  path: string;
  lastEventId: string | null;
};
export type ServerEventStreamOptions = {
  enabled?: boolean;
  identityKey?: string | number | null;
  onResync?: (context: ServerEventResyncContext) => void;
  onConnectionChange?: (connected: boolean) => void;
};
type Listener = { callback: (event: SseEnvelope) => void; scope: string };
const listeners = new Map<string, Set<Listener>>();
const client = new RealtimeClient({
  headers: () => ({ cookie: authClient.getCookie() }),
  onResync: ({ reason, topic, lastEventId }) => {
    emit({
      topic,
      type: EVENTS.REALTIME_RESYNC,
      id: lastEventId ?? "0",
      at: new Date().toISOString(),
      data: { reason, path: pathForScope(topic), lastEventId },
    });
  },
});
function pathForScope(scope: string): string {
  if (scope === REALTIME_SCOPES.QUEUE) return "/api/queue/stream";
  if (scope === REALTIME_SCOPES.LOGISTICS) return "/api/logistics/stream";
  return "/api/queue/me/stream";
}
let identity: string | number | null = null;
let origin = "";
let lifecycle: { remove: () => void } | undefined;
let streamRefs = 0;
let identityGeneration = 0;
const scopeRefs = new Map<string, number>();
const connectedScopes = new Map<string, boolean>();
export const isServerEventConnected = (scope = REALTIME_SCOPES.PERSONAL): boolean =>
  connectedScopes.get(scope) === true;

export function setServerEventIdentity(next: string | number | null): void {
  if (identity === next && origin === API_URL) return;
  scopeRefs.clear();
  connectedScopes.clear();
  identityGeneration++;
  lifecycle?.remove();
  lifecycle = undefined;
  streamRefs = 0;
  identity = next;
  origin = API_URL;
  client.setIdentity(next, origin);
  listeners.clear();
}
onApiUrlChange?.(() => setServerEventIdentity(null));
/** Logical filters apply to recovery signals as well as events (#892). */
export function subscribeToServerEvent(
  type: string,
  callback: (event: SseEnvelope) => void,
  scope: string = REALTIME_SCOPES.PERSONAL,
): () => void {
  const current = listeners.get(type) ?? new Set<Listener>();
  const listener = { callback, scope };
  current.add(listener);
  listeners.set(type, current);
  return () => {
    current.delete(listener);
    if (!current.size) listeners.delete(type);
  };
}
function emit(event: SseEnvelope): void {
  for (const listener of listeners.get(event.type) ?? []) {
    if (listener.scope === event.topic) listener.callback(event);
  }
}
function start(
  scope: string,
  path: string,
  options: boolean | ServerEventStreamOptions = true,
): () => void {
  const normalized = typeof options === "boolean" ? { enabled: options } : options;
  if (normalized.enabled === false || Platform.OS === "web" || identity === null)
    return () => undefined;
  const generation = identityGeneration;
  streamRefs++;
  scopeRefs.set(scope, (scopeRefs.get(scope) ?? 0) + 1);
  if (!lifecycle) {
    client.setActive((AppState?.currentState ?? "active") === "active");
    lifecycle = AppState?.addEventListener?.("change", (state) =>
      client.setActive(state === "active"),
    );
  }
  const stop = client.subscribe({
    scope,
    onConnectionChange: (connected) => {
      connectedScopes.set(scope, connected);
      normalized.onConnectionChange?.(connected);
    },
    onEvent: emit,
    onResync: ({ reason, lastEventId }) => {
      normalized.onResync?.({ reason, path, lastEventId });
    },
  });
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    stop();
    if (generation !== identityGeneration) return;
    const remaining = (scopeRefs.get(scope) ?? 1) - 1;
    if (remaining === 0) {
      scopeRefs.delete(scope);
      connectedScopes.delete(scope);
    } else scopeRefs.set(scope, remaining);
    streamRefs--;
    if (streamRefs === 0) {
      lifecycle?.remove();
      lifecycle = undefined;
    }
  };
}
export function startPersonalEventStream(options: ServerEventStreamOptions = {}): () => void {
  return start(REALTIME_SCOPES.PERSONAL, "/api/queue/me/stream", options);
}
export function startQueueEventStream(
  options: boolean | ServerEventStreamOptions = true,
): () => void {
  return start(REALTIME_SCOPES.QUEUE, "/api/queue/stream", options);
}
export function startLogisticsEventStream(
  options: boolean | ServerEventStreamOptions = true,
): () => void {
  return start(REALTIME_SCOPES.LOGISTICS, "/api/logistics/stream", options);
}
