"use client";

import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { MultiSelect } from "@/components/common/multi-select";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  const [confirmedParticipantsOnly, setConfirmedParticipantsOnly] = useState(true);
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

  const options = useMemo(
    () =>
      scopes.map((scope) => ({
        value: scope.key,
        label: scope.name,
        description:
          scope.kind === "application" ? t("applicationScopeLabel") : t("roleScopeLabel"),
      })),
    [scopes, t],
  );
  const selectedApplicationScopes = scopes.filter(
    (scope) => scope.kind === "application" && selectedScopes.includes(scope.key),
  );
  const exportParams = new URLSearchParams({ scopes: selectedScopes.join(",") });
  if (selectedApplicationScopes.length > 0) {
    exportParams.set("participant_filter", confirmedParticipantsOnly ? "confirmed" : "submitted");
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
      <div className="space-y-2">
        <Label htmlFor="statistics-export-scopes">{t("selectStatisticsScopes")}</Label>
        <MultiSelect
          id="statistics-export-scopes"
          options={options}
          value={selectedScopes}
          onChange={setSelectedScopes}
          disabled={loading || scopes.length === 0}
          placeholder={t("selectStatisticsScopes")}
          searchPlaceholder={t("searchStatisticsScopes")}
          emptyText={t("noStatisticsScopes")}
          aria-label={t("selectStatisticsScopes")}
        />
        <p className="text-muted-foreground text-xs" role="status" aria-live="polite">
          {t("statisticsScopesSelected", { count: selectedScopes.length })}
        </p>
      </div>
      {selectedApplicationScopes.length > 0 && (
        <div className="flex items-center gap-2">
          <Switch
            id="statistics-export-confirmed-participants"
            checked={confirmedParticipantsOnly}
            onCheckedChange={setConfirmedParticipantsOnly}
          />
          <Label htmlFor="statistics-export-confirmed-participants" className="cursor-pointer">
            {t(
              confirmedParticipantsOnly ? "confirmedParticipantsOnly" : "allSubmittedApplications",
            )}
          </Label>
        </div>
      )}
    </SidePanelEditor>
  );
}
