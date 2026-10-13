import { REALTIME_SCOPES } from "@hackos/shared/events";
import {
  RealtimeClient,
  type RealtimeConsumer,
  type ResyncReason,
} from "@hackos/shared/realtime-client";
import { observePhysicalSseConnection } from "./realtime-telemetry";

export type SseResyncReason = ResyncReason;
export type SseResyncContext = { reason: ResyncReason; topic: string; lastEventId: string | null };
type Subscriber = Omit<RealtimeConsumer, "scope"> & { identityKey?: string | number | null };
const authenticated = new RealtimeClient({ onPhysicalConnection: observePhysicalSseConnection });
const publicClients = new Map<string, RealtimeClient>();
let identity: string | number | null = null;
let identityRevision = 0;
let origin = "";
const identityListeners = new Set<() => void>();

export function setSseIdentity(next: string | number | null, apiOrigin: string): void {
  if (typeof window !== "undefined")
    apiOrigin = new URL(apiOrigin || "/", window.location.origin).origin;
  if (next === identity && apiOrigin === origin) return;
  identityRevision++;
  identity = next;
  origin = apiOrigin;
  authenticated.setIdentity(next, apiOrigin);
  for (const client of publicClients.values()) client.setIdentity(null, apiOrigin);
  publicClients.clear();
  for (const listener of identityListeners) listener();
}
export const sseIdentitySnapshot = () => identityRevision;
export const subscribeSseIdentity = (listener: () => void) => {
  identityListeners.add(listener);
  return () => {
    identityListeners.delete(listener);
  };
};

const PUBLIC_STREAM_PATHS: Record<string, string> = {
  [REALTIME_SCOPES.PUBLIC_TV]: "/api/tv/stream",
  [REALTIME_SCOPES.PUBLIC_CONTENT]: "/api/content/stream",
};

/** Every authenticated scope joins the session owner's union, independent of component keys (#892). */
export function subscribeToSse(scope: string, apiUrl: string, subscriber: Subscriber): () => void {
  if (!scope) throw new Error("Realtime scope is required");
  const apiOrigin = apiUrl
    ? new URL(apiUrl, typeof window === "undefined" ? undefined : window.location.origin).origin
    : "";
  if (apiOrigin !== origin) setSseIdentity(identity, apiOrigin);
  const publicPath = PUBLIC_STREAM_PATHS[scope];
  let client = authenticated;
  if (publicPath && identity === null) {
    client =
      publicClients.get(publicPath) ??
      new RealtimeClient({ publicPath, onPhysicalConnection: observePhysicalSseConnection });
    client.setIdentity(null, apiOrigin);
    publicClients.set(publicPath, client);
  } else if (identity === null) return () => undefined;
  return client.subscribe({ ...subscriber, scope });
}
