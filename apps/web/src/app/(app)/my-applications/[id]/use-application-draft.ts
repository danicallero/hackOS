"use client";

import { type MutableRefObject, useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import type { Translate } from "@/lib/i18n";
import type { SaveState } from "@/lib/save-state";
import { toast } from "@/lib/toast";
import type { ActionError, MyResponseDetail } from "../lib";

interface Options {
  applicationId: number;
  formOpen: boolean;
  response: MyResponseDetail | null;
  responseError: string | null;
  editable: boolean;
  values: Record<string, unknown>;
  answerRevision: number;
  latestAnswerRevision: MutableRefObject<number>;
  hasLocalEdits: MutableRefObject<boolean>;
  saveState: SaveState;
  saving: boolean;
  t: Translate;
  setResponse: React.Dispatch<React.SetStateAction<MyResponseDetail | null>>;
  setValues: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  setSaving: React.Dispatch<React.SetStateAction<boolean>>;
  setSaveState: React.Dispatch<React.SetStateAction<SaveState>>;
  setActionError: React.Dispatch<React.SetStateAction<ActionError | null>>;
}

/** Owns draft creation and persistence so the form page can focus on submit
 * and state transitions. A draft always exists before a file field is used. */
export function useApplicationDraft({
  applicationId,
  formOpen,
  response,
  responseError,
  editable,
  values,
  answerRevision,
  latestAnswerRevision,
  hasLocalEdits,
  saveState,
  saving,
  t,
  setResponse,
  setValues,
  setSaving,
  setSaveState,
  setActionError,
}: Options) {
  const stopped = useRef(false);
  const pendingWrites = useRef(new Set<Promise<MyResponseDetail>>());
  const [discarding, setDiscarding] = useState(false);
  const writeDraft = useCallback(
    (responses: Record<string, unknown>) => {
      const request = api.put<MyResponseDetail>(`/api/applications/${applicationId}/response`, {
        responses,
      });
      pendingWrites.current.add(request);
      const settled = () => pendingWrites.current.delete(request);
      void request.then(settled, settled);
      return request;
    },
    [applicationId],
  );

  const discardDraft = useCallback(async () => {
    stopped.current = true;
    setDiscarding(true);
    try {
      // Wait for writes already sent, then delete. Cancelling fetch alone cannot
      // prevent a server-side autosave from committing after deletion (H12).
      await Promise.allSettled([...pendingWrites.current]);
      await api.delete(`/api/applications/${applicationId}/response`);
    } catch (error) {
      stopped.current = false;
      setDiscarding(false);
      setSaveState(hasLocalEdits.current ? "unsaved" : "saved");
      throw error;
    }
  }, [applicationId, hasLocalEdits, setSaveState]);

  const saveDraft = useCallback(async () => {
    if (stopped.current) return;
    // Each request owns the answer revision that it serializes. Controls stay
    // editable while it is in flight, so its response is only authoritative
    // when no later local edit exists (#844).
    const savedRevision = answerRevision;
    setSaving(true);
    setSaveState("saving");
    setActionError(null);
    try {
      const saved = await writeDraft(values);
      if (stopped.current) return;
      if (latestAnswerRevision.current !== savedRevision) {
        setSaveState("unsaved");
        return;
      }
      // PUT returns the response row only; retain the immutable template
      // resolved by GET so an autosave cannot make the page fall back to a
      // newer public form version.
      setResponse((previous) =>
        previous?.template
          ? { ...saved, template: previous.template, sections: previous.sections }
          : saved,
      );
      hasLocalEdits.current = false;
      setValues(saved.responses ?? {});
      setSaveState("saved");
    } catch (error) {
      if (stopped.current) return;
      if (latestAnswerRevision.current !== savedRevision) {
        setSaveState("unsaved");
        return;
      }
      setSaveState("error");
      const message = apiErrorText(error, t, t("couldNotSaveDraft"));
      setActionError({ action: "save", message });
      toast.error(message, t("saveDraft"));
    } finally {
      setSaving(false);
    }
  }, [
    answerRevision,
    writeDraft,
    hasLocalEdits,
    latestAnswerRevision,
    setActionError,
    setResponse,
    setSaveState,
    setSaving,
    setValues,
    t,
    values,
  ]);

  useEffect(() => {
    if (stopped.current || discarding || !formOpen || response || responseError) return;
    let active = true;
    void writeDraft({})
      .then((draft) => {
        if (!active || stopped.current) return;
        setResponse(draft);
      })
      .catch((error) => {
        if (!active || stopped.current) return;
        setActionError({
          action: "save",
          message: apiErrorText(error, t, t("couldNotSaveDraft")),
        });
      });
    return () => {
      active = false;
    };
  }, [discarding, formOpen, response, responseError, setActionError, setResponse, t, writeDraft]);

  useEffect(() => {
    if (
      stopped.current ||
      discarding ||
      !editable ||
      !response ||
      saving ||
      saveState !== "unsaved"
    )
      return;
    const timer = window.setTimeout(() => void saveDraft(), 700);
    return () => window.clearTimeout(timer);
  }, [discarding, editable, response, saveDraft, saveState, saving]);

  return { saveDraft, discardDraft, discarding };
}
