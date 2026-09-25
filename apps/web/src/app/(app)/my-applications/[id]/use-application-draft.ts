"use client";

import { useCallback, useEffect } from "react";
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
  saveState: SaveState;
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
  saveState,
  t,
  setResponse,
  setValues,
  setSaving,
  setSaveState,
  setActionError,
}: Options) {
  const saveDraft = useCallback(async () => {
    setSaving(true);
    setSaveState("saving");
    setActionError(null);
    try {
      const saved = await api.put<MyResponseDetail>(`/api/applications/${applicationId}/response`, {
        responses: values,
      });
      // PUT returns the response row only; retain the immutable template
      // resolved by GET so an autosave cannot make the page fall back to a
      // newer public form version.
      setResponse((previous) =>
        previous?.template
          ? { ...saved, template: previous.template, sections: previous.sections }
          : saved,
      );
      setValues(saved.responses ?? {});
      setSaveState("saved");
      toast.success(t("draftSaved"));
    } catch (error) {
      setSaveState("error");
      const message = error instanceof ApiError ? error.message : t("couldNotSaveDraft");
      setActionError({ action: "save", message });
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }, [applicationId, setActionError, setResponse, setSaveState, setSaving, setValues, t, values]);

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
    if (!editable || !response || saveState !== "unsaved") return;
    const timer = window.setTimeout(() => void saveDraft(), 700);
    return () => window.clearTimeout(timer);
  }, [editable, response, saveDraft, saveState]);

  return saveDraft;
}
