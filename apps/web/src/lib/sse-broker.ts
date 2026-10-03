import { realtimeScopeForPath } from "@hackos/shared/events";
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

/** All authenticated reader paths join the session owner's union, independent of component keys (#892). */
export function subscribeToSse(url: string, subscriber: Subscriber): () => void {
  const parsed = new URL(
    url,
    typeof window === "undefined" ? "http://sse.invalid" : window.location.origin,
  );
  const scope = realtimeScopeForPath(parsed.toString());
  if (!scope) throw new Error(`Unknown realtime reader: ${parsed.pathname}`);
  const apiOrigin = parsed.origin === "http://sse.invalid" ? "" : parsed.origin;
  if (apiOrigin !== origin) setSseIdentity(identity, apiOrigin);
  const isPublic = scope === "public-tv" || scope === "public-content";
  let client = authenticated;
  if (isPublic && identity === null) {
    client =
      publicClients.get(parsed.pathname) ??
      new RealtimeClient({
        publicPath: parsed.pathname,
        onPhysicalConnection: observePhysicalSseConnection,
      });
    client.setIdentity(null, apiOrigin);
    publicClients.set(parsed.pathname, client);
  } else if (identity === null) return () => undefined;
  return client.subscribe({ ...subscriber, scope });
}
