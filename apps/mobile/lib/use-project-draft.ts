import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import { discardProjectDraft, type NativeProject, projectDraftWriter } from "./projects";

type DraftState = "saved" | "dirty" | "saving" | "error" | "conflict";

/**
 * H20: drafts remain in memory on failure; conflicts require explicit reload.
 * The writer belongs to the project, not the screen, so answers given just
 * before leaving (or arriving from an upload after leaving) are still saved.
 */
export function useProjectDraft(project: NativeProject) {
  const [writer] = useState(() => projectDraftWriter(project));
  const [responses, setResponses] = useState(writer.current);
  // Answers this editor could not save last time are resumed, not dropped.
  const [state, setState] = useState<DraftState>(writer.dirty ? "dirty" : "saved");
  const [error, setError] = useState<Error | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const flush = useCallback(async () => {
    if (stateRef.current === "conflict") throw error;
    if (!writer.dirty && !writer.saving) return;
    if (active.current) setState("saving");
    try {
      await writer.flush();
      if (active.current) {
        setState("saved");
        setError(null);
      }
    } catch (cause) {
      const failure = cause instanceof Error ? cause : new Error(String(cause));
      const conflict = cause instanceof ApiError && cause.status === 409;
      if (conflict) discardProjectDraft(project.id);
      if (active.current) {
        setError(failure);
        setState(conflict ? "conflict" : "error");
      }
      throw failure;
    }
  }, [error, writer, project.id]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: each edit restarts the debounce
  useEffect(() => {
    if (state !== "dirty") return;
    const timer = setTimeout(() => {
      void flush().catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [responses, state, flush]);
  /** `value` may derive from the newest answer, e.g. appending to a photo list. */
  const change = useCallback(
    (key: string, value: unknown | ((current: unknown) => unknown)) => {
      if (stateRef.current === "conflict") return;
      const previous = writer.current;
      const next = {
        ...previous,
        [key]: typeof value === "function" ? value(previous[key]) : value,
      };
      writer.change(next);
      if (active.current) {
        setResponses(next);
        setState("dirty");
      } else {
        // The editor closed (e.g. an upload finished afterwards): save now.
        void writer.flush().catch(() => {});
      }
    },
    [writer],
  );
  return { responses, state, error, change, flush };
}
