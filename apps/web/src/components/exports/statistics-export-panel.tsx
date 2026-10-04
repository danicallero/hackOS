"use client";

import type { StatisticsParticipantStatus } from "@hackos/shared/statistics";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { StatisticsScopeFilterMenu } from "@/components/statistics/statistics-scope-filter-menu";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";

interface StatisticsScope {
  key: string;
  kind: "application" | "role";
  name: string;
}

export function StatisticsExportPanel({ trigger }: { trigger?: ReactNode }) {
  const { t } = useLocale();
  const [scopes, setScopes] = useState<StatisticsScope[]>([]);
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
  const [participantStatusesByApplication, setParticipantStatusesByApplication] = useState<
    Record<string, StatisticsParticipantStatus[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<{ scopes: StatisticsScope[] }>("/api/statistics/scopes");
      setScopes(response.scopes);
      setSelectedScopes((current) => {
        const available = new Set(response.scopes.map((scope) => scope.key));
        const retained = current.filter((key) => available.has(key));
        return retained.length > 0 || current.length > 0
          ? retained
          : response.scopes.map((scope) => scope.key);
      });
    } catch (loadError) {
      setError(loadError instanceof ApiError ? loadError.message : t("statisticsExportLoadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- statistics scopes are an external API source.
    void load();
  }, [load]);

  const selectedApplicationScopes = scopes.filter(
    (scope) => scope.kind === "application" && selectedScopes.includes(scope.key),
  );
  const exportParams = new URLSearchParams({ scopes: selectedScopes.join(",") });
  if (selectedApplicationScopes.length > 0) {
    exportParams.set(
      "participant_filters",
      JSON.stringify(
        Object.fromEntries(
          selectedApplicationScopes.map((scope) => [
            scope.key,
            participantStatusesByApplication[scope.key] ?? ["confirmed"],
          ]),
        ),
      ),
    );
  }
  const href = `${API_URL}/api/exports/statistics.csv?${exportParams.toString()}`;

  return (
    <SidePanelEditor
      trigger={
        trigger ?? (
          <Button variant="outline">
            <DownloadSimpleIcon aria-hidden="true" />
            {t("export")}
          </Button>
        )
      }
      title={t("statisticsExportTitle")}
      footer={
        selectedScopes.length > 0 ? (
          <Button asChild disabled={loading}>
            <a href={href}>
              <DownloadSimpleIcon aria-hidden="true" />
              {t("export")}
            </a>
          </Button>
        ) : (
          <Button disabled>
            <DownloadSimpleIcon aria-hidden="true" />
            {t("export")}
          </Button>
        )
      }
    >
      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t("statisticsExportLoadFailed")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <section className="space-y-3" aria-labelledby="statistics-export-scope-heading">
        <div className="flex items-center justify-between gap-3">
          <h3 id="statistics-export-scope-heading" className="type-label">
            {t("selectStatisticsScopes")}
          </h3>
        </div>
        {scopes.length > 0 && (
          <div className="max-h-52 overflow-y-auto rounded-control border border-border bg-muted/20 p-3">
            <StatisticsScopeFilterMenu
              scopes={scopes}
              selectedScopeKeys={selectedScopes}
              participantStatusesByApplication={participantStatusesByApplication}
              onScopeChange={setSelectedScopes}
              onParticipantStatusesChange={(scopeKey, statuses) =>
                setParticipantStatusesByApplication((current) => ({
                  ...current,
                  [scopeKey]: statuses,
                }))
              }
              className="w-full items-start"
              chipsClassName="flex flex-wrap gap-2"
            />
          </div>
        )}
        <p className="text-muted-foreground text-xs" role="status" aria-live="polite">
          {t("statisticsScopesSelected", { count: selectedScopes.length })}
        </p>
      </section>
    </SidePanelEditor>
  );
}
