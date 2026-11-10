import { useSyncExternalStore } from "react";
import type { HelpChallenge } from "./help-desk";

/**
 * H65: the challenge picker is its own sheet, so the request form and the
 * sheet share one draft. The form seeds it on open; the sheet edits it; the
 * form reads it back (same pattern as the topic draft).
 */
let state: { selected: HelpChallenge | null } = { selected: null };
const listeners = new Set<() => void>();

export function seedChallengeSelection(selected: HelpChallenge | null): void {
  state = { selected };
  for (const listener of listeners) listener();
}

export function setChallengeSelection(selected: HelpChallenge | null): void {
  state = { selected };
  for (const listener of listeners) listener();
}

export function useChallengeSelection(): { selected: HelpChallenge | null } {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => state,
  );
}
