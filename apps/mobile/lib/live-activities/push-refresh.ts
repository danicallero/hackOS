import { isLiveActivityPushCategory } from "@hackos/shared/live-activities";

/**
 * Push-triggered Live Activity refresh (#966, H38/H59). A notification such
 * as `queue.called` is committed before the worker's APNs update for the
 * same change, which can arrive late or not at all (a push-started activity
 * has no update token until the app reports it). The app therefore re-reads
 * `GET /api/me/live-activities` itself when one arrives.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

/**
 * The notification `category` from an Expo push's data: top level for the
 * received/response listeners, nested under `body` or `dataString` in the
 * iOS background task payload.
 */
export function pushCategory(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  for (const candidate of [record, record.body, record.dataString]) {
    let value = candidate;
    if (typeof value === "string") {
      try {
        value = JSON.parse(value);
      } catch {
        continue;
      }
    }
    const category = (value as Record<string, unknown> | null)?.category;
    if (typeof category === "string") return category;
  }
  return undefined;
}

export function isLiveActivityPush(data: unknown): boolean {
  return isLiveActivityPushCategory(pushCategory(data));
}

/** The foreground orchestration subscribes; it debounces with its other triggers. */
export function subscribeToLiveActivityPushes(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called for every received or tapped notification; ignores unrelated ones. */
export function notifyLiveActivityPush(data: unknown): void {
  if (!isLiveActivityPush(data)) return;
  for (const listener of listeners) listener();
}
