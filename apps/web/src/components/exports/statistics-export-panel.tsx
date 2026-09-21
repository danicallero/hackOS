"use client";

import { BarChart3Icon, DownloadIcon, ExternalLinkIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MultiSelect } from "@/components/common/multi-select";
import { SectionCard } from "@/components/common/section-card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";

interface StatisticsScope {
  key: string;
  kind: "application" | "role";
  name: string;
}

export function StatisticsExportPanel({ canExport }: { canExport: boolean }) {
  const { t } = useLocale();
  const [scopes, setScopes] = useState<StatisticsScope[]>([]);
  const [selectedScopes, setSelectedScopes] = useState<string[]>([]);
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
  const href = `${API_URL}/api/exports/statistics.csv?scopes=${encodeURIComponent(selectedScopes.join(","))}`;

  return (
    <SectionCard
      title={t("statisticsExportTitle")}
      description={t("statisticsExportDesc")}
      icon={BarChart3Icon}
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
          maxVisibleBadges={4}
        />
        <p className="text-muted-foreground text-xs" role="status" aria-live="polite">
          {t("statisticsScopesSelected", { count: selectedScopes.length })}
        </p>
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        {canExport && selectedScopes.length > 0 ? (
          <Button asChild>
            <a href={href}>
              <DownloadIcon aria-hidden="true" />
              {t("exportStatistics")}
            </a>
          </Button>
        ) : (
          <Button asChild variant="outline">
            <Link href="/logistics/stats">
              <ExternalLinkIcon aria-hidden="true" />
              {t("openStatisticsWorkspace")}
            </Link>
          </Button>
        )}
      </div>
    </SectionCard>
  );
}
