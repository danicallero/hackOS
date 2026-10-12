"use client";

import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { ArrowsOutSimpleIcon } from "@phosphor-icons/react/dist/csr/ArrowsOutSimple";
import { ChartBarIcon } from "@phosphor-icons/react/dist/csr/ChartBar";
import { ChartLineIcon } from "@phosphor-icons/react/dist/csr/ChartLine";
import { ChartPieIcon } from "@phosphor-icons/react/dist/csr/ChartPie";
import { useState } from "react";
import { IconButton } from "@/components/common/icon-button";
import { Modal } from "@/components/common/modal";
import { SectionCard } from "@/components/common/section-card";
import { type StatTone, statToneSurfaceClass } from "@/components/common/stat-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocale } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { StatsChart, type StatsChartDatum, type StatsChartType } from "./stats-chart";

const FULLSCREEN_CHART_HEIGHT = "clamp(320px, calc(100dvh - 12rem), 900px)";

function ChartTypeSelect({
  title,
  value,
  onChange,
}: {
  title: string;
  value: StatsChartType;
  onChange: (chartType: StatsChartType) => void;
}) {
  const { t } = useLocale();
  return (
    <Select value={value} onValueChange={(next) => onChange(next as StatsChartType)}>
      <SelectTrigger
        size="sm"
        className="w-auto min-w-36 shrink-0"
        aria-label={t("selectChartTypeFor", { title })}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="bar">
          <span className="flex items-center gap-2">
            <ChartBarIcon aria-hidden="true" />
            {t("chartTypeBar")}
          </span>
        </SelectItem>
        <SelectItem value="pie">
          <span className="flex items-center gap-2">
            <ChartPieIcon aria-hidden="true" />
            {t("chartTypePie")}
          </span>
        </SelectItem>
        <SelectItem value="line">
          <span className="flex items-center gap-2">
            <ChartLineIcon aria-hidden="true" />
            {t("chartTypeLine")}
          </span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

/**
 * H27: every statistics chart (before, during, after) is a card whose chart can
 * be opened full screen — the same view the meal detail already offers — so
 * organisers can project or inspect it. When `onChartTypeChange` is given the
 * viewer can switch bar/pie/line in the card and in the full-screen view.
 */
export function ChartCard({
  title,
  rows,
  chartType,
  onChartTypeChange,
  tone = "neutral",
  icon,
  state,
  className,
}: {
  title: string;
  rows: StatsChartDatum[];
  chartType: StatsChartType;
  onChartTypeChange?: (chartType: StatsChartType) => void;
  tone?: StatTone;
  icon?: PhosphorIcon;
  state?: React.ReactNode;
  className?: string;
}) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const typeSelect = onChartTypeChange && (
    <ChartTypeSelect title={title} value={chartType} onChange={onChartTypeChange} />
  );
  return (
    <>
      <SectionCard
        title={title}
        icon={icon}
        state={state}
        className={cn("h-full", statToneSurfaceClass[tone], className)}
        action={
          <div className="flex items-center gap-2">
            {typeSelect}
            <IconButton
              label={t("chartFullscreen", { title })}
              variant="ghost"
              size="icon-sm"
              disabled={rows.length === 0}
              onClick={() => setExpanded(true)}
            >
              <ArrowsOutSimpleIcon aria-hidden="true" />
            </IconButton>
          </div>
        }
      >
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-pretty text-sm">{t("noDistributionData")}</p>
        ) : (
          <StatsChart data={rows} type={chartType} title={title} />
        )}
      </SectionCard>
      <Modal
        open={expanded}
        onOpenChange={setExpanded}
        title={title}
        className="h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] sm:max-w-none"
        headerActions={typeSelect}
      >
        <StatsChart data={rows} type={chartType} title={title} height={FULLSCREEN_CHART_HEIGHT} />
      </Modal>
    </>
  );
}
