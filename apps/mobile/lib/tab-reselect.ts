import { useEffect, useRef } from "react";

/**
 * Pressing the tab that is already selected is UIKit's "return to the start" gesture. A tab's
 * screen subscribes with `useTabReselect(name, handler)` and resets its own state (the two-pane
 * Scanner and Activities clear their selected person or activity) (H55).
 */
type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

export function emitTabReselect(tabName: string): void {
  for (const listener of listeners.get(tabName) ?? []) listener();
}

export function subscribeTabReselect(tabName: string, listener: Listener): () => void {
  const set = listeners.get(tabName) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(tabName, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(tabName);
  };
}

/** Runs `handler` when the user presses the already-selected tab `tabName`. */
export function useTabReselect(tabName: string, handler: () => void): void {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => subscribeTabReselect(tabName, () => latest.current()), [tabName]);
}
