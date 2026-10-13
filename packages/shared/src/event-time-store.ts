import { deviceTimeZone, isValidTimeZone } from "@hackos/shared/event-time";
/** H45/H47: each client owns a store, shared validation/fallback and notifications. */
export function createEventTimeZoneStore() {
  let eventZone: string | null = null;
  const listeners = new Set<() => void>();
  return {
    setEventTimeZone(zone: string | null | undefined): void {
      const next = isValidTimeZone(zone) ? zone : null;
      if (next === eventZone) return;
      eventZone = next;
      for (const listener of listeners) listener();
    },
    getEventTimeZone(): string {
      return eventZone ?? deviceTimeZone();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
