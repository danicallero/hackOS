type Listener = (badgeId: string) => void;

const listeners = new Map<number, Set<Listener>>();

export function subscribeToManualActivityScan(activityId: number, listener: Listener): () => void {
  let activityListeners = listeners.get(activityId);
  if (!activityListeners) {
    activityListeners = new Set();
    listeners.set(activityId, activityListeners);
  }
  activityListeners.add(listener);
  return () => {
    activityListeners.delete(listener);
    if (activityListeners.size === 0) listeners.delete(activityId);
  };
}

export function emitManualActivityScan(activityId: number, badgeId: string): void {
  for (const listener of listeners.get(activityId) ?? []) listener(badgeId);
}
