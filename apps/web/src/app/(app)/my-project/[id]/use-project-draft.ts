"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import type { Translate } from "@/lib/i18n";
import { invalidateProjectReads, type NativeProject, nativeProjects } from "@/lib/native-projects";
import type { SaveState } from "@/lib/save-state";

/** H20/#844: serialize writes and never replace newer local answers with a stale response. */
export function useProjectDraft(
  project: Pick<NativeProject, "id" | "responses" | "revision">,
  t: Translate,
  staff = false,
) {
  const [values, setValues] = useState(project.responses);
  const [state, setState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const local = useRef(project.responses);
  const revision = useRef(project.revision);
  const sequence = useRef(0);
  const pending = useRef<Promise<boolean> | null>(null);
  const conflict = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const change = useCallback((key: string, value: unknown) => {
    local.current = { ...local.current, [key]: value };
    sequence.current += 1;
    setValues(local.current);
    setState(pending.current ? "saving" : "unsaved");
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (pending.current) return pending.current;
    if (conflict.current) return false;
    const ownedSequence = sequence.current;
    const answers = local.current;
    setState("saving");
    setError(null);
    const request = (async () => {
      try {
        const saved = staff
          ? await api.put<Pick<NativeProject, "revision" | "responses">>(
              `/api/repos/${project.id}/draft`,
              { responses: answers, revision: revision.current },
            )
          : await nativeProjects.saveDraft(project.id, answers, revision.current);
        invalidateProjectReads(project.id);
        revision.current = saved.revision;
        if (!mounted.current) return false;
        if (ownedSequence !== sequence.current) {
          setState("unsaved");
          return false;
        }
        local.current = saved.responses;
        setValues(saved.responses);
        setState("saved");
        return true;
      } catch (cause) {
        if (!mounted.current) return false;
        conflict.current = cause instanceof ApiError && cause.status === 409;
        setError(
          conflict.current
            ? t("projectDraftConflict")
            : apiErrorText(cause, t, t("couldNotSaveDraft")),
        );
        setState("error");
        return false;
      } finally {
        pending.current = null;
      }
    })();
    pending.current = request;
    return request;
  }, [project.id, t, staff]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: every answer edit restarts the autosave debounce.
  useEffect(() => {
    if (state !== "unsaved" || conflict.current) return;
    const timer = window.setTimeout(() => void save(), 700);
    return () => window.clearTimeout(timer);
  }, [state, values, save]);

  useEffect(() => {
    if (state === "saved") return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [state]);

  return { values, state, error, change, save };
}
