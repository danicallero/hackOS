type Listener = () => void;

const listenersByCategory = new Map<string, Set<Listener>>();
const changeListeners = new Set<Listener>();

/**
 * Minimal in-process pub-sub keyed by notification `category` (the field the
 * API now includes in every push message's `data`, see
 * apps/api/src/modules/notifications/channels/push.ts). Lets a screen react
 * immediately to a push notification arriving/being tapped while it's
 * mounted, instead of waiting for its next poll — see lib/push.ts (emits) and
 * app/(tabs)/queue.tsx (subscribes to "queue").
 */
export function subscribeToCategory(category: string, listener: Listener): () => void {
  let set = listenersByCategory.get(category);
  if (!set) {
    set = new Set();
    listenersByCategory.set(category, set);
  }
  set.add(listener);
  return () => set.delete(listener);
}

export function emitCategory(category: string | undefined): void {
  if (!category) return;
  for (const listener of listenersByCategory.get(category) ?? []) listener();
  for (const listener of changeListeners) listener();
}

/** Subscribe to any inbox-affecting notification event, regardless of category. */
export function subscribeToNotificationChanges(listener: Listener): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/** Notify global listeners after an in-app mutation such as marking an item read. */
export function emitNotificationChange(): void {
  for (const listener of changeListeners) listener();
}
