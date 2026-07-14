import type { SseEnvelope } from "@hackos/shared/events";
import { Platform } from "react-native";
import { authClient } from "./auth-client";
import { API_URL } from "./env";

type Listener = (event: SseEnvelope) => void;
const listeners = new Map<string, Set<Listener>>();

export function subscribeToServerEvent(type: string, listener: Listener): () => void {
  const current = listeners.get(type) ?? new Set<Listener>();
  current.add(listener);
  listeners.set(type, current);
  return () => current.delete(listener);
}

function emit(event: SseEnvelope): void {
  for (const listener of listeners.get(event.type) ?? []) listener(event);
}

function consumeBlock(block: string): void {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!data) return;
  try {
    const envelope = JSON.parse(data) as SseEnvelope;
    if (typeof envelope.type === "string") emit(envelope);
  } catch {
    // A malformed event is isolated; the next server envelope can still be
    // consumed and the periodic full refetch remains the recovery path.
  }
}

/**
 * Native authenticated SSE loop for the personal user topic (H28/H38). The
 * Better Auth Expo plugin exposes the restored Cookie header, which avoids a
 * browser cookie jar dependency. RN's fetch response body is a readable
 * stream, so no EventSource polyfill is required.
 */
export function startPersonalEventStream(): () => void {
  if (Platform.OS === "web") return () => undefined;
  let stopped = false;
  let controller: AbortController | null = null;
  let reconnect: ReturnType<typeof setTimeout> | null = null;
  let failedConnections = 0;

  const retryAfter = (response: Response): number | null => {
    const value = response.headers.get("retry-after");
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const date = Date.parse(value);
    return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
  };

  const connect = async () => {
    controller = new AbortController();
    let serverDelay: number | null = null;
    try {
      const response = await fetch(`${API_URL}/api/queue/me/stream`, {
        headers: { cookie: authClient.getCookie(), accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        serverDelay = retryAfter(response);
        throw new Error(`SSE failed (${response.status})`);
      }
      failedConnections = 0;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          consumeBlock(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch (error) {
      if (!stopped && !(error instanceof DOMException && error.name === "AbortError")) {
        // Reconnect below. Screens also retain their bounded polling fallback.
      }
    } finally {
      if (!stopped) {
        const backoff = Math.min(1_000 * 2 ** failedConnections, 30_000);
        failedConnections += 1;
        // Respect the proxy's Retry-After while bounding recovery time.
        const delay = Math.min(serverDelay ?? backoff, 60_000);
        reconnect = setTimeout(() => void connect(), delay);
      }
    }
  };
  void connect();
  return () => {
    stopped = true;
    controller?.abort();
    if (reconnect) clearTimeout(reconnect);
  };
}
