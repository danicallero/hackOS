"use client";

import { type MutableRefObject, useCallback, useEffect } from "react";
import { ApiError, api } from "@/lib/api";
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
  const saveDraft = useCallback(async () => {
    // Each request owns the answer revision that it serializes. Controls stay
    // editable while it is in flight, so its response is only authoritative
    // when no later local edit exists (#844).
    const savedRevision = answerRevision;
    setSaving(true);
    setSaveState("saving");
    setActionError(null);
    try {
      const saved = await api.put<MyResponseDetail>(`/api/applications/${applicationId}/response`, {
        responses: values,
      });
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
      toast.success(t("draftSaved"));
    } catch (error) {
      if (latestAnswerRevision.current !== savedRevision) {
        setSaveState("unsaved");
        return;
      }
      setSaveState("error");
      const message = error instanceof ApiError ? error.message : t("couldNotSaveDraft");
      setActionError({ action: "save", message });
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }, [
    answerRevision,
    applicationId,
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
    if (!formOpen || response || responseError) return;
    let active = true;
    void api
      .put<MyResponseDetail>(`/api/applications/${applicationId}/response`, { responses: {} })
      .then((draft) => {
        if (!active) return;
        setResponse(draft);
      })
      .catch((error) => {
        if (!active) return;
        setActionError({
          action: "save",
          message: error instanceof ApiError ? error.message : t("couldNotSaveDraft"),
        });
      });
    return () => {
      active = false;
    };
  }, [applicationId, formOpen, response, responseError, setActionError, setResponse, t]);

  useEffect(() => {
    if (!editable || !response || saving || saveState !== "unsaved") return;
    const timer = window.setTimeout(() => void saveDraft(), 700);
    return () => window.clearTimeout(timer);
  }, [editable, response, saveDraft, saveState, saving]);

  return saveDraft;
}
