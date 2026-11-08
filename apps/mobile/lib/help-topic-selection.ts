import { useSyncExternalStore } from "react";
import type { HelpTopic } from "./help-desk";

/**
 * H61/H64: the knowledge-topic picker is its own sheet, so the form that opened
 * it and the sheet share one draft selection. The form seeds it on open; the
 * sheet edits it; the form reads it back. Only one form is mounted at a time.
 * `other` is the request's "Other" choice, offered only when `allowOther`
 * (the request form; a helper's knowledge has no Other).
 */
interface TopicSelection {
  selected: HelpTopic[];
  maximum: number;
  other: boolean;
  allowOther: boolean;
  /** Whether this person may add a name to the catalogue (an eligible helper). */
  allowAdd: boolean;
}

let state: TopicSelection = {
  selected: [],
  maximum: 5,
  other: false,
  allowOther: false,
  allowAdd: false,
};
const listeners = new Set<() => void>();

function publish(next: TopicSelection): void {
  state = next;
  for (const listener of listeners) listener();
}

export function seedTopicSelection(
  selected: HelpTopic[],
  maximum: number,
  other: boolean | null = null,
  allowAdd = false,
): void {
  publish({ selected, maximum, other: other === true, allowOther: other !== null, allowAdd });
}

/** Choosing a catalogue topic drops "Other": a request is about topics or about something else. */
export function setTopicSelection(selected: HelpTopic[]): void {
  publish({ ...state, selected, other: selected.length > 0 ? false : state.other });
}

/** Choosing "Other" clears the catalogue topics. */
export function setOtherSelection(other: boolean): void {
  publish({ ...state, other, selected: other ? [] : state.selected });
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
