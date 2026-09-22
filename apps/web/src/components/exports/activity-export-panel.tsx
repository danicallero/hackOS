"use client";

import { CalendarCheckIcon, DownloadIcon, RefreshCwIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { MultiSelect } from "@/components/common/multi-select";
import { SidePanelEditor } from "@/components/common/side-panel-editor";
import { ExportSensitivityBadge } from "@/components/exports/export-sensitivity-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ApiError, api } from "@/lib/api";
import { API_URL } from "@/lib/env";
import { useLocale } from "@/lib/i18n";
import { toast } from "@/lib/toast";

interface ActivityExportOption {
  id: number;
  name: string;
  category: string;
  starts_at: string | null;
  ends_at: string | null;
  scan_count: number;
  distinct_people: number;
}

type ExportMode = "people" | "scans";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

async function downloadActivityExport(
  activityIds: number[],
  mode: ExportMode,
  language: string,
): Promise<void> {
  const response = await fetch(`${API_URL}/api/exports/activities.csv`, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({ activity_ids: activityIds, mode, language }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { message?: string };
    } | null;
    throw new Error(payload?.error?.message ?? "Activity export failed");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = mode === "people" ? "activity-attendance.csv" : "activity-scans.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function ActivityExportPanel({ trigger }: { trigger?: ReactNode }) {
  const { language, t } = useLocale();
  const [activities, setActivities] = useState<ActivityExportOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mode, setMode] = useState<ExportMode>("people");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<{ activities: ActivityExportOption[] }>(
        "/api/exports/activities/catalog",
        { query: { language } },
      );
      setActivities(response.activities);
      setSelectedIds((current) => {
        const available = new Set(response.activities.map((activity) => String(activity.id)));
        const retained = current.filter((id) => available.has(id));
        return retained.length > 0 || current.length > 0
          ? retained
          : response.activities.map((activity) => String(activity.id));
      });
    } catch (loadError) {
      const message = errorMessage(loadError, t("activityExportCatalogFailed"));
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [language, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- catalog fetch synchronises this selector with the API.
    void load();
  }, [load]);

  const options = useMemo(
    () =>
      activities.map((activity) => ({
        value: String(activity.id),
        label: activity.name,
        description: `${activity.category} · ${activity.distinct_people} ${t("peopleLabel")} · ${activity.scan_count} ${t("scansLabel")}`,
      })),
    [activities, t],
  );

  const exportData = async () => {
    if (selectedIds.length === 0) {
      setError(t("activityExportNoSelection"));
      return;
    }
    setExporting(true);
    setError(null);
    try {
      await downloadActivityExport(selectedIds.map(Number), mode, language);
      toast.success(t("activityExportDownloaded"));
    } catch (exportError) {
      const message = errorMessage(exportError, t("activityExportFailed"));
      setError(message);
      toast.error(message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <SidePanelEditor
      trigger={
        trigger ?? (
          <Button variant="outline">
            <CalendarCheckIcon aria-hidden="true" />
            {t("export")}
          </Button>
        )
      }
      title={t("activityAttendanceExport")}
      icon={CalendarCheckIcon}
      footer={
        <Button
          onClick={() => void exportData()}
          disabled={loading || exporting || selectedIds.length === 0}
        >
          <DownloadIcon aria-hidden="true" />
          {exporting ? t("loading") : t("export")}
        </Button>
      }
    >
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCwIcon aria-hidden="true" />
          {t("refresh")}
        </Button>
      </div>
      <ExportSensitivityBadge />
      {error && (
        <Alert variant="destructive">
          <AlertTitle>{t("activityExportFailed")}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="activity-export-selection">{t("selectActivitiesToExport")}</Label>
          <div className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelectedIds(activities.map((activity) => String(activity.id)))}
              disabled={loading || activities.length === 0}
            >
              {t("selectAll")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelectedIds([])}
              disabled={loading || activities.length === 0}
            >
              {t("clear")}
            </Button>
          </div>
        </div>
        <MultiSelect
          id="activity-export-selection"
          options={options}
          value={selectedIds}
          onChange={setSelectedIds}
          disabled={loading || activities.length === 0}
          placeholder={t("selectActivitiesToExport")}
          searchPlaceholder={t("searchActivitiesToExport")}
          emptyText={t("noActivitiesToExport")}
          aria-label={t("selectActivitiesToExport")}
        />
        <p className="text-muted-foreground text-xs" role="status" aria-live="polite">
          {t("activitiesSelected", { count: selectedIds.length })}
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="type-meta font-medium text-foreground">{t("activityExportRows")}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["people", "activityExportPeople", "activityExportPeopleDesc"],
              ["scans", "activityExportScans", "activityExportScansDesc"],
            ] as const
          ).map(([value, labelKey, descriptionKey]) => (
            <label
              key={value}
              className="flex items-start gap-3 rounded-control border border-border px-3 py-2.5 hover:bg-muted/50"
            >
              <input
                type="radio"
                name="activity-export-mode"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
                className="mt-1 size-4 shrink-0 accent-primary focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="min-w-0">
                <span className="block font-medium">{t(labelKey)}</span>
                <span className="text-muted-foreground block text-sm text-pretty">
                  {t(descriptionKey)}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </SidePanelEditor>
  );
}
