import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import { type NativeProject, ProjectDraftWriter, projectMutation } from "./projects";

/** H20: drafts remain in memory on failure; conflicts require explicit reload. */
export function useProjectDraft(project: NativeProject) {
  const [responses, setResponses] = useState(project.responses);
  const responsesRef = useRef(project.responses);
  const [state, setState] = useState<"saved" | "dirty" | "saving" | "error" | "conflict">("saved");
  const [error, setError] = useState<Error | null>(null);
  const active = useRef(true);
  const [writer] = useState(
    () =>
      new ProjectDraftWriter(project.revision, project.responses, (answers, revision) =>
        projectMutation(`/api/me/projects/${project.id}/draft`, "PUT", {
          responses: answers,
          revision,
        }),
      ),
  );
  useEffect(() => {
    active.current = true;
    writer.resume();
    return () => {
      active.current = false;
      writer.dispose();
    };
  }, [writer]);
  const flush = useCallback(async () => {
    if (state === "conflict") throw error;
    if (!writer.dirty) return;
    setState("saving");
    try {
      await writer.flush();
      if (active.current) {
        setState("saved");
        setError(null);
      }
    } catch (cause) {
      const failure = cause instanceof Error ? cause : new Error(String(cause));
      if (active.current) {
        setError(failure);
        setState(cause instanceof ApiError && cause.status === 409 ? "conflict" : "error");
      }
      throw failure;
    }
  }, [error, state, writer]);
  useEffect(() => {
    if (state !== "dirty" || !responses) return;
    const timer = setTimeout(() => {
      void flush().catch(() => {});
    }, 600);
    return () => clearTimeout(timer);
  }, [responses, state, flush]);
  function change(key: string, value: unknown) {
    if (state === "conflict") return;
    const next = { ...responsesRef.current, [key]: value };
    responsesRef.current = next;
    writer.change(next);
    setResponses(next);
    setState("dirty");
  }
  return { responses, state, error, change, flush };
}
