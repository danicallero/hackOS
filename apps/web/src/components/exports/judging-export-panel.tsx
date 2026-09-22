"use client";

import { DownloadIcon, GavelIcon, RefreshCwIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { type Challenge, textForDisplay } from "@/app/(app)/challenges/shared";
import { EntityCombobox } from "@/components/common/entity-combobox";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function JudgingExportPanel({ trigger }: { trigger?: ReactNode }) {
  const { t } = useLocale();
  const [challenges, setChallenges] = useState<Challenge[]>([]);
  const [selectedChallenge, setSelectedChallenge] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<{ challenges: Challenge[] }>("/api/challenges");
      setChallenges(response.challenges);
      setSelectedChallenge((current) => current || String(response.challenges[0]?.id ?? ""));
    } catch (loadError) {
      setError(errorMessage(loadError, t("judgingExportLoadFailed")));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- challenge list is an external API source.
    void load();
  }, [load]);

  const challengeId = Number(selectedChallenge);

  return (
    <SidePanelEditor
      trigger={
        trigger ?? (
          <Button variant="outline">
            <GavelIcon aria-hidden="true" />
            {t("export")}
          </Button>
        )
      }
      title={t("judgingExportTitle")}
      icon={GavelIcon}
    >
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCwIcon aria-hidden="true" />
          {t("refresh")}
        </Button>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t("judgingExportLoadFailed")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <label htmlFor="judging-export-challenge" className="text-sm font-medium">
          {t("selectChallengeToExport")}
        </label>
        <EntityCombobox
          id="judging-export-challenge"
          options={challenges}
          value={selectedChallenge}
          onChange={setSelectedChallenge}
          getId={(challenge) => challenge.id}
          getLabel={(challenge) => textForDisplay(challenge.title)}
          disabled={loading || challenges.length === 0}
          placeholder={t("selectChallengeToExport")}
          searchPlaceholder={t("searchChallenges")}
          emptyText={t("noChallengesToExport")}
        />
      </div>
      <div className="space-y-3 border-t border-border pt-4">
        {challengeId > 0 && (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">{t("judgingQueue")}</span>
              <Button asChild variant="outline" size="sm">
                <a href={`${API_URL}/api/queue/challenges/${challengeId}/export/queue.csv`}>
                  <DownloadIcon aria-hidden="true" />
                  {t("export")}
                </a>
              </Button>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium">{t("judgingEvaluations")}</span>
              <Button asChild variant="outline" size="sm">
                <a href={`${API_URL}/api/queue/challenges/${challengeId}/export/evaluations.csv`}>
                  <DownloadIcon aria-hidden="true" />
                  {t("export")}
                </a>
              </Button>
            </div>
          </>
        )}
      </div>
    </SidePanelEditor>
  );
}
