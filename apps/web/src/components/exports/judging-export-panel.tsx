"use client";

import { DownloadIcon, ExternalLinkIcon, GavelIcon, RefreshCwIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { type Challenge, textForDisplay } from "@/app/(app)/challenges/shared";
import { EntityCombobox } from "@/components/common/entity-combobox";
import { SectionCard } from "@/components/common/section-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export function JudgingExportPanel() {
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
    <SectionCard
      title={t("judgingExportTitle")}
      description={t("judgingExportDesc")}
      icon={GavelIcon}
      action={
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCwIcon aria-hidden="true" />
          {t("refresh")}
        </Button>
      }
    >
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
      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        {challengeId > 0 && (
          <>
            <Button asChild variant="outline">
              <a href={`${API_URL}/api/queue/challenges/${challengeId}/export/queue.csv`}>
                <DownloadIcon aria-hidden="true" />
                {t("exportQueueCsv")}
              </a>
            </Button>
            <Button asChild variant="outline">
              <a href={`${API_URL}/api/queue/challenges/${challengeId}/export/evaluations.csv`}>
                <DownloadIcon aria-hidden="true" />
                {t("exportEvaluationsCsv")}
              </a>
            </Button>
          </>
        )}
        <Button asChild variant="ghost">
          <Link href="/queue/reviews">
            <ExternalLinkIcon aria-hidden="true" />
            {t("openReviewsExport")}
          </Link>
        </Button>
      </div>
    </SectionCard>
  );
}
