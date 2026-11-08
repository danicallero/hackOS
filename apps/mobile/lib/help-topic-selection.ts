import { useSyncExternalStore } from "react";
import type { HelpTopic } from "./help-desk";

/**
 * H61/H64: the knowledge-topic picker is its own sheet, so the form that opened
 * it and the sheet share one draft selection. The form seeds it on open; the
 * sheet edits it; the form reads it back. Only one form is mounted at a time.
 */
interface TopicSelection {
  selected: HelpTopic[];
  maximum: number;
}

let state: TopicSelection = { selected: [], maximum: 5 };
const listeners = new Set<() => void>();

export function seedTopicSelection(selected: HelpTopic[], maximum: number): void {
  state = { selected, maximum };
  for (const listener of listeners) listener();
}

export function setTopicSelection(selected: HelpTopic[]): void {
  state = { ...state, selected };
  for (const listener of listeners) listener();
}

export function useTopicSelection(): TopicSelection {
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
