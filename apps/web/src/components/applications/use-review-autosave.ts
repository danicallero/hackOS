"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { SaveState } from "@/lib/save-state";

const AUTOSAVE_DELAY_MS = 700;

interface Draft {
  responseId: number;
  score: number | null;
  notes: string;
  dirty: boolean;
  editSessionId: string;
}

function putMyReview(draft: Pick<Draft, "responseId" | "score" | "notes" | "editSessionId">) {
  return api.put(`/api/responses/${draft.responseId}/my-review`, {
    edit_session_id: draft.editSessionId,
    score: draft.score,
    notes: draft.notes.trim() || null,
  });
}

/**
 * The reviewer's own score/notes for one response, autosaved after a pause.
 *
 * Only a local edit marks the draft dirty, so reseeding on navigation or
 * applying an update broadcast by the other review window never re-PUTs an
 * unchanged score — that is what keeps the modal and the popup from racing to
 * save the same row. A dirty draft is flushed when the reviewer moves to
 * another response or the owner unmounts.
 */
export function useReviewAutosave(
  responseId: number,
  canReview: boolean,
  initial: { score: number | null; notes: string },
  onSaved?: () => void,
) {
  // H13: navigation changes the prop before reseeding; never publish the old
  // applicant’s draft under the new response id.
  const [draftResponseId, setDraftResponseId] = useState(responseId);
  const [score, setScore] = useState(initial.score);
  const [notes, setNotes] = useState(initial.notes);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [dirty, setDirty] = useState(false);
  const draftRef = useRef<Draft>({ responseId, ...initial, dirty: false, editSessionId: "" });
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const edit = useCallback(
    (next: { score: number | null; notes: string }) => {
      draftRef.current = {
        responseId,
        ...next,
        dirty: true,
        editSessionId: draftRef.current.editSessionId || crypto.randomUUID(),
      };
      setScore(next.score);
      setNotes(next.notes);
      setDirty(true);
      setSaveState("saving");
    },
    [responseId],
  );

  /** Starts over on `id`, first saving what was left unsaved on another response. */
  const seed = useCallback(
    (id: number, value: { score: number | null; notes: string }, state: SaveState = "saved") => {
      const pending = draftRef.current;
      if (pending.responseId !== id && pending.dirty && canReview) {
        putMyReview(pending).catch((error) =>
          console.error("[review:autosave] flush failed", error),
        );
      }
      draftRef.current = {
        responseId: id,
        ...value,
        dirty: false,
        editSessionId: pending.responseId === id ? pending.editSessionId : "",
      };
      setDraftResponseId(id);
      setScore(value.score);
      setNotes(value.notes);
      setSaveState(state);
      setDirty(false);
    },
    [canReview],
  );

  /** Mirrors a value saved elsewhere unless the reviewer has unsaved local edits; returns whether it applied. */
  const applyRemote = useCallback(
    (value: { score: number | null; notes: string; saveState: SaveState }): boolean => {
      if (draftRef.current.dirty) return false;
      if (value.score === score && value.notes === notes && value.saveState === saveState)
        return false;
      setScore(value.score);
      setNotes(value.notes);
      setSaveState(value.saveState);
      return true;
    },
    [score, notes, saveState],
  );

  useEffect(
    () => () => {
      const pending = draftRef.current;
      if (!pending.dirty || !canReview) return;
      putMyReview(pending).catch((error) => console.error("[review:autosave] flush failed", error));
    },
    [canReview],
  );

  useEffect(() => {
    // While navigating, the response id changes before the caller reseeds;
    // never save the previous response's draft into the new one.
    if (!dirty || !canReview || draftRef.current.responseId !== responseId) return;
    const handle = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        await putMyReview({
          responseId,
          score,
          notes,
          editSessionId: draftRef.current.editSessionId,
        });
        // H13: an older in-flight save must not cancel a newer draft's timer.
        const current = draftRef.current;
        if (current.responseId !== responseId || current.score !== score || current.notes !== notes)
          return;
        current.dirty = false;
        setSaveState("saved");
        setDirty(false);
        onSavedRef.current?.();
      } catch (error) {
        console.error("[review:autosave] save failed", error);
        setSaveState("error");
      }
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(handle);
  }, [responseId, score, notes, dirty, canReview]);

  return {
    responseId: draftResponseId,
    score,
    notes,
    saveState,
    isDirty: () => draftRef.current.dirty,
    setScore: (value: number | null) => edit({ score: value, notes }),
    setNotes: (value: string) => edit({ score, notes: value }),
    seed,
    applyRemote,
  };
}
