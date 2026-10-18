"use client";
import { useCallback, useEffect, useState } from "react";
import { ContextualError } from "@/components/common/contextual-error";
import { DateTimeInput } from "@/components/common/datetime-input";
import { SaveStatus } from "@/components/common/save-status";
import { SectionCard } from "@/components/common/section-card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { fromLocalInputValue, toLocalInputValue } from "@/lib/event-datetime";
import { useLocale } from "@/lib/i18n";
import type { SaveState } from "@/lib/save-state";
import { useUnsavedChangesGuard } from "@/lib/use-unsaved-changes-guard";

type Publication = { publishAt: string | null; publishedAt: string | null };
/** H60: private editor data stays in this authorized challenge view only. */
export function WinnerPublication({ challengeId }: { challengeId: number }) {
  const { t } = useLocale();
  const [publication, setPublication] = useState<Publication | null>(null);
  const [value, setValue] = useState("");
  const [state, setState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  useUnsavedChangesGuard(state === "unsaved" || state === "error");
  const load = useCallback(async () => {
    try {
      const result = await api.get<Publication>(
        `/api/challenges/${challengeId}/winners/publication`,
        { cache: "no-store" },
      );
      setPublication(result);
      setValue(toLocalInputValue(result.publishAt));
      setError(null);
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotLoadWinners")));
    }
  }, [challengeId, t]);
  useEffect(() => {
    void load();
  }, [load]);
  async function save() {
    setState("saving");
    setError(null);
    try {
      const result = await api.put<Publication>(
        `/api/challenges/${challengeId}/winners/publication`,
        { publishAt: fromLocalInputValue(value) },
      );
      setPublication(result);
      setState("saved");
    } catch (cause) {
      setError(apiErrorText(cause, t, t("couldNotSaveWinner")));
      setState("error");
    }
  }
  return (
    <div>
      <SectionCard
        title={t("projectWinnersPublishAt")}
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <SaveStatus state={state} showIcon={state !== "saving"} />
            <Button
              type="button"
              onClick={() => void save()}
              loading={state === "saving"}
              disabled={!publication || state === "saved"}
            >
              {t("saveChanges")}
            </Button>
          </div>
        }
      >
        {error && <ContextualError message={error} onRetry={load} />}
        {publication?.publishedAt ? (
          <p className="text-sm">{t("projectWinnersPublished")}</p>
        ) : (
          <p className="mb-4 text-sm text-muted-foreground">{t("projectWinnersPrivate")}</p>
        )}
        <Label className="sr-only" htmlFor="winner-publication-date">
          {t("projectWinnersPublishAt")}
        </Label>
        <DateTimeInput
          id="winner-publication-date"
          value={value}
          disabled={!publication || state === "saving"}
          onChange={(next) => {
            setValue(next);
            setState("unsaved");
          }}
        />
      </SectionCard>
    </div>
  );
}
