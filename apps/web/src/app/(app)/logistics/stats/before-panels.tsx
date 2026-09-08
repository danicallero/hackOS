"use client";

import {
  BadgeCheckIcon,
  ClipboardListIcon,
  EyeIcon,
  EyeOffIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { IconButton } from "@/components/common/icon-button";
import { SectionCard } from "@/components/common/section-card";
import { StatCard } from "@/components/common/stat-card";
import { LOCALE_CODES, pickText, type Translate, useLocale } from "@/lib/i18n";
import { uiPrefsApi } from "@/lib/logistics";
import type { ApplicationStats } from "./model";

export function BeforePanels({ stats }: { stats: ApplicationStats | null }) {
  const { language, t } = useLocale();
  const [hidden, setHidden] = useState<string[]>([]);
  useEffect(() => {
    void uiPrefsApi.get().then((prefs) => {
      const value = prefs.applicationStatsPanels;
      if (value && typeof value === "object" && "hidden" in value && Array.isArray(value.hidden)) {
        setHidden(value.hidden.filter((key): key is string => typeof key === "string"));
      }
    });
  }, []);
  const togglePanel = useCallback((key: string) => {
    setHidden((current) => {
      const next = current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key];
      void uiPrefsApi.set("applicationStatsPanels", { hidden: next });
      return next;
    });
  }, []);
  const sent = stats?.funnel?.sent ?? 0;
  const confirmed = stats?.funnel?.confirmed ?? 0;
  const submitted = Object.entries(stats?.counts_by_status ?? {}).reduce(
    (total, [status, count]) => total + (status === "draft" ? 0 : count),
    0,
  );
  const rate = sent === 0 ? null : Math.round((confirmed / sent) * 100);
  const dateLabel = (bucket: string) =>
    new Intl.DateTimeFormat(LOCALE_CODES[language], { day: "numeric", month: "short" }).format(
      new Date(`${bucket}T00:00:00Z`),
    );

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("submittedApplications")} value={submitted} icon={ClipboardListIcon} />
        <StatCard label={t("confirmed")} value={confirmed} icon={BadgeCheckIcon} />
        <StatCard
          label={t("confirmationRate")}
          value={rate === null ? "—" : `${rate}%`}
          icon={ShieldCheckIcon}
        />
        <StatCard
          label={t("averageConfirmationTime")}
          value={hours(stats?.time_to_confirm_hours?.avg, t)}
          icon={RefreshCwIcon}
          hint={`${t("medianConfirmationTime")}: ${hours(stats?.time_to_confirm_hours?.median, t)}`}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Distribution
          title={t("applicationFunnel")}
          panelKey="funnel"
          hidden={hidden.includes("funnel")}
          onToggle={togglePanel}
          rows={[
            { label: t("decisionsSent"), n: sent },
            { label: t("dataStatusAccepted"), n: stats?.funnel?.still_in_window ?? 0 },
            { label: t("confirmed"), n: confirmed },
            { label: t("declined"), n: stats?.funnel?.declined ?? 0 },
            { label: t("dataStatusExpired"), n: stats?.funnel?.expired ?? 0 },
          ]}
        />
        <Distribution
          title={t("shirtSizeDistribution")}
          panelKey="shirt-sizes"
          hidden={hidden.includes("shirt-sizes")}
          onToggle={togglePanel}
          rows={(stats?.shirt_sizes_confirmed ?? []).map((row) => ({ label: row.value, n: row.n }))}
        />
        <Distribution
          title={t("submissionEvolution")}
          panelKey="submissions-by-day"
          hidden={hidden.includes("submissions-by-day")}
          onToggle={togglePanel}
          rows={(stats?.time_series?.submissions_by_day ?? []).map((row) => ({
            label: dateLabel(row.bucket),
            n: row.n,
          }))}
        />
        <Distribution
          title={t("confirmationEvolution")}
          panelKey="confirmations-by-day"
          hidden={hidden.includes("confirmations-by-day")}
          onToggle={togglePanel}
          rows={(stats?.time_series?.confirmations_by_day ?? []).map((row) => ({
            label: dateLabel(row.bucket),
            n: row.n,
          }))}
        />
        <Distribution
          title={t("submissionsByHour")}
          panelKey="submissions-by-hour"
          hidden={hidden.includes("submissions-by-hour")}
          onToggle={togglePanel}
          rows={(stats?.time_series?.submissions_by_hour_of_day ?? []).map((row) => ({
            label: String(row.hour).padStart(2, "0"),
            n: row.n,
          }))}
        />
        <Distribution
          title={t("submissionsByDay")}
          panelKey="submissions-by-dow"
          hidden={hidden.includes("submissions-by-dow")}
          onToggle={togglePanel}
          rows={(stats?.time_series?.submissions_by_day_of_week ?? []).map((row) => ({
            label: new Intl.DateTimeFormat(LOCALE_CODES[language], { weekday: "short" }).format(
              new Date(Date.UTC(2024, 0, 7 + row.dow)),
            ),
            n: row.n,
          }))}
        />
      </div>
      {(stats?.field_distributions.length ?? 0) > 0 && (
        <SectionCard title={t("applicationData")} description={t("applicationDataDescription")}>
          <div className="grid gap-4 xl:grid-cols-2">
            {stats?.field_distributions.map((distribution) => {
              const labels = new Map(
                distribution.field.options.map((option) => [
                  option.value,
                  pickText(option.label, language),
                ]),
              );
              return (
                <Distribution
                  key={distribution.field.key}
                  title={pickText(distribution.field.label, language)}
                  panelKey={`field:${distribution.field.key.toLowerCase()}`}
                  hidden={hidden.includes(`field:${distribution.field.key.toLowerCase()}`)}
                  onToggle={togglePanel}
                  rows={distribution.buckets.map((bucket) => ({
                    label:
                      labels.get(bucket.value) ??
                      (bucket.value === "true"
                        ? t("booleanYes")
                        : bucket.value === "false"
                          ? t("booleanNo")
                          : bucket.value),
                    n: bucket.n,
                  }))}
                />
              );
            })}
          </div>
        </SectionCard>
      )}
    </>
  );
}

function hours(value: number | null | undefined, t: Translate): string {
  return value === null || value === undefined
    ? "—"
    : t("hoursShort", { value: Math.round(value) });
}

function Distribution({
  title,
  rows,
  panelKey,
  hidden = false,
  onToggle,
}: {
  title: string;
  rows: Array<{ label: string; n: number }>;
  panelKey?: string;
  hidden?: boolean;
  onToggle?: (key: string) => void;
}) {
  const { t } = useLocale();
  const action =
    panelKey && onToggle ? (
      <IconButton
        label={hidden ? t("showStatisticsPanel") : t("hideStatisticsPanel")}
        variant="ghost"
        size="icon-sm"
        onClick={() => onToggle(panelKey)}
      >
        {hidden ? <EyeIcon /> : <EyeOffIcon />}
      </IconButton>
    ) : null;
  if (hidden) {
    return (
      <SectionCard title={title} action={action}>
        <p className="text-muted-foreground text-sm">{t("statisticsPanelHidden")}</p>
      </SectionCard>
    );
  }
  const max = Math.max(...rows.map((row) => row.n), 0);
  return (
    <SectionCard title={title} action={action}>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-pretty text-sm">{t("noDistributionData")}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
              <span className="truncate text-sm font-medium" title={row.label}>
                {row.label}
              </span>
              <span className="text-muted-foreground tabular-nums text-sm">{row.n}</span>
              <div
                className="bg-muted col-span-2 h-2 overflow-hidden rounded-full"
                aria-hidden="true"
              >
                <div
                  className="bg-success h-full rounded-full"
                  style={{ width: `${max === 0 ? 0 : (row.n / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
