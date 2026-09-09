"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  BadgeCheckIcon,
  BarChart3Icon,
  Clock3Icon,
  EyeIcon,
  EyeOffIcon,
  FileTextIcon,
  HourglassIcon,
  LayoutDashboardIcon,
  LineChartIcon,
  PieChartIcon,
  RotateCcwIcon,
  ShieldXIcon,
  TimerOffIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DragHandle } from "@/components/common/drag-handle";
import { EmptyState } from "@/components/common/empty-state";
import { IconButton } from "@/components/common/icon-button";
import { SectionCard } from "@/components/common/section-card";
import { StatCard, type StatTone, statToneSurfaceClass } from "@/components/common/stat-card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { LOCALE_CODES, type MessageKey, pickText, type Translate, useLocale } from "@/lib/i18n";
import { uiPrefsApi } from "@/lib/logistics";
import { cn } from "@/lib/utils";
import type { ApplicationStats } from "./model";
import { StatsChart, type StatsChartDatum, type StatsChartType } from "./stats-chart";
import {
  defaultStatsChartType,
  defaultStatsPanelSize,
  type StatsLayoutConfig,
  sanitizeStatsLayout,
} from "./stats-layout";

const STORAGE_KEY = "hackos:applicationStatsLayouts:v1";

interface DistributionDefinition {
  key: string;
  title: string;
  rows: StatsChartDatum[];
  defaultChart: StatsChartType;
}

const STAT_TONES: StatTone[] = ["neutral", "success", "danger", "warning", "info"];

const DEFAULT_OVERVIEW_TONES: Record<string, StatTone> = {
  submitted: "info",
  confirmed: "success",
  rejected: "danger",
  rate: "success",
  expired: "warning",
  available: "info",
  time: "neutral",
};

const BASE_PANEL_LABELS: Record<string, MessageKey> = {
  overview: "statisticsOverviewPanel",
  "shirt-sizes": "shirtSizeDistribution",
  "food-intolerances": "dietaryDistribution",
  "applications-over-time": "applicationsOverTime",
  "confirmations-over-time": "confirmationsOverTime",
  "applications-by-hour": "submissionsByHour",
  "applications-by-day-of-week": "submissionsByDay",
};

function panelKeysForStats(stats: ApplicationStats | null): string[] {
  if (!stats) return ["overview"];
  if (stats.panel_keys && stats.panel_keys.length > 0) return stats.panel_keys;
  const keys: string[] = [];
  if (stats.counts_by_status !== undefined) keys.push("overview");
  if (stats.shirt_sizes_confirmed !== undefined) keys.push("shirt-sizes");
  if (stats.food_intolerances_confirmed !== undefined) keys.push("food-intolerances");
  if (stats.time_series?.submissions_by_day !== undefined) keys.push("applications-over-time");
  if (stats.time_series?.confirmations_by_day !== undefined) keys.push("confirmations-over-time");
  if (stats.time_series?.submissions_by_hour_of_day !== undefined)
    keys.push("applications-by-hour");
  if (stats.time_series?.submissions_by_day_of_week !== undefined)
    keys.push("applications-by-day-of-week");
  for (const field of stats.field_distributions ?? [])
    keys.push(`field:${field.field.key.toLowerCase()}`);
  return keys;
}

function panelTitle(key: string, labels: Map<string, string>, t: Translate): string {
  const base = BASE_PANEL_LABELS[key];
  return base ? t(base) : (labels.get(key) ?? key.replace(/^field:/, "").replaceAll(/[-_.]/g, " "));
}

function readLocalLayout(layoutKey: string): unknown {
  try {
    const raw = JSON.parse(localStorage.getItem(`${STORAGE_KEY}:${layoutKey}`) ?? "null");
    return raw;
  } catch {
    return null;
  }
}

function writeLocalLayout(layoutKey: string, layout: StatsLayoutConfig): void {
  try {
    localStorage.setItem(`${STORAGE_KEY}:${layoutKey}`, JSON.stringify(layout));
  } catch {
    // localStorage is an acceleration only; the account preference remains authoritative.
  }
}

export function BeforePanels({
  applicationId,
  layoutKey,
  stats,
  loading,
  error,
  onRetry,
  editMode = false,
}: {
  applicationId: number | null;
  layoutKey?: string;
  stats: ApplicationStats | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  editMode?: boolean;
}) {
  const { language, t } = useLocale();
  const resolvedLayoutKey = layoutKey ?? (applicationId ? String(applicationId) : "");
  const availablePanelKeys = useMemo(() => panelKeysForStats(stats), [stats]);
  const [layout, setLayout] = useState<StatsLayoutConfig>(() =>
    sanitizeStatsLayout(null, ["overview"]),
  );
  const loadedLayout = useRef<string | null>(null);
  const availablePanelKeysRef = useRef(availablePanelKeys);
  availablePanelKeysRef.current = availablePanelKeys;
  const rawLayouts = useRef<Record<string, unknown>>({});
  const storedLayouts = useRef<Record<string, unknown>>({});

  useEffect(() => {
    if (!resolvedLayoutKey || loadedLayout.current === resolvedLayoutKey) return;
    loadedLayout.current = resolvedLayoutKey;
    const local = readLocalLayout(resolvedLayoutKey);
    rawLayouts.current[resolvedLayoutKey] = local;
    setLayout(sanitizeStatsLayout(local, availablePanelKeysRef.current));
    let active = true;
    uiPrefsApi
      .get()
      .then((prefs) => {
        if (!active) return;
        const remoteStore =
          prefs.applicationStatsLayouts && typeof prefs.applicationStatsLayouts === "object"
            ? (prefs.applicationStatsLayouts as Record<string, unknown>)
            : {};
        storedLayouts.current = remoteStore;
        const remote = remoteStore[resolvedLayoutKey] ?? prefs.applicationStatsPanels;
        if (remote) {
          rawLayouts.current[resolvedLayoutKey] = remote;
          const next = sanitizeStatsLayout(remote, availablePanelKeysRef.current);
          setLayout(next);
          writeLocalLayout(resolvedLayoutKey, next);
        }
      })
      .catch(() => {
        // The local copy keeps the dashboard usable while offline.
      });
    return () => {
      active = false;
    };
  }, [resolvedLayoutKey]);

  useEffect(() => {
    if (!resolvedLayoutKey) return;
    const raw = rawLayouts.current[resolvedLayoutKey];
    if (raw !== undefined) setLayout(sanitizeStatsLayout(raw, availablePanelKeys));
  }, [resolvedLayoutKey, availablePanelKeys]);

  const effectiveLayout = useMemo(
    () => sanitizeStatsLayout(layout, availablePanelKeys),
    [availablePanelKeys, layout],
  );
  const labels = useMemo(
    () =>
      new Map(
        (stats?.field_distributions ?? []).map((distribution) => [
          `field:${distribution.field.key.toLowerCase()}`,
          pickText(distribution.field.statistics?.label ?? distribution.field.label, language),
        ]),
      ),
    [language, stats?.field_distributions],
  );

  const saveLayout = useCallback(
    (next: StatsLayoutConfig) => {
      setLayout(next);
      if (!resolvedLayoutKey) return;
      rawLayouts.current[resolvedLayoutKey] = next;
      writeLocalLayout(resolvedLayoutKey, next);
      const nextStore = { ...storedLayouts.current, [resolvedLayoutKey]: next };
      storedLayouts.current = nextStore;
      void uiPrefsApi.set("applicationStatsLayouts", nextStore).catch(() => {});
    },
    [resolvedLayoutKey],
  );

  const togglePanel = (panelKey: string) => {
    const hidden = effectiveLayout.hidden.includes(panelKey)
      ? effectiveLayout.hidden.filter((key) => key !== panelKey)
      : [...effectiveLayout.hidden, panelKey];
    saveLayout({ ...effectiveLayout, hidden });
  };

  const definitions = useMemo(
    () => buildDistributionDefinitions(stats, language, t),
    [language, stats, t],
  );
  const definitionByKey = useMemo(
    () => new Map(definitions.map((definition) => [definition.key, definition])),
    [definitions],
  );
  const visibleKeys = effectiveLayout.order.filter(
    (key) => availablePanelKeys.includes(key) && !effectiveLayout.hidden.includes(key),
  );
  const gridKeys = effectiveLayout.order.filter((key) => availablePanelKeys.includes(key));
  const renderedKeys = editMode ? gridKeys : visibleKeys;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onPanelDragEnd = (event: DragEndEvent) => {
    if (!editMode || !event.over || event.active.id === event.over.id) return;
    const from = effectiveLayout.order.indexOf(String(event.active.id));
    const to = effectiveLayout.order.indexOf(String(event.over.id));
    if (from === -1 || to === -1) return;
    saveLayout({ ...effectiveLayout, order: arrayMove(effectiveLayout.order, from, to) });
  };

  const resizePanel = (key: string, axis: "width" | "height", delta: -1 | 1) => {
    const current = effectiveLayout.sizes[key] ?? defaultStatsPanelSize(key);
    const nextValue = Math.max(1, Math.min(2, current[axis] + delta)) as 1 | 2;
    saveLayout({
      ...effectiveLayout,
      sizes: { ...effectiveLayout.sizes, [key]: { ...current, [axis]: nextValue } },
    });
  };

  const setTone = (key: string, tone: StatTone) => {
    saveLayout({
      ...effectiveLayout,
      tones: { ...effectiveLayout.tones, [key]: tone },
    });
  };

  const renderPanel = (key: string) => {
    if (key === "overview") {
      return (
        <OverviewPanel
          key={key}
          stats={stats}
          loading={loading}
          error={error}
          onRetry={onRetry}
          editMode={editMode}
          tone={effectiveLayout.tones.overview ?? "neutral"}
          kpiTones={effectiveLayout.tones}
          onToneChange={setTone}
        />
      );
    }
    const definition = definitionByKey.get(key);
    if (!definition) return null;
    return (
      <Distribution
        key={key}
        title={definition.title}
        rows={definition.rows}
        chartType={effectiveLayout.charts[key] ?? definition.defaultChart}
        tone={effectiveLayout.tones[key] ?? "neutral"}
        onChartTypeChange={(chartType) =>
          saveLayout({
            ...effectiveLayout,
            charts: { ...effectiveLayout.charts, [key]: chartType },
          })
        }
      />
    );
  };

  return (
    <div className="space-y-5">
      {editMode && (
        <div className="bg-muted/30 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <p className="text-muted-foreground min-w-0 flex-1 text-pretty text-sm" role="status">
            {t("statisticsEditModeHint")}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => saveLayout(sanitizeStatsLayout(null, availablePanelKeys))}
          >
            <RotateCcwIcon aria-hidden="true" />
            {t("resetStatisticsLayout")}
          </Button>
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onPanelDragEnd}>
        <SortableContext items={renderedKeys} strategy={rectSortingStrategy}>
          <div className="grid items-start gap-4 xl:grid-cols-2">
            {renderedKeys.map((key) => (
              <SortablePanel
                key={key}
                id={key}
                editMode={editMode}
                hidden={effectiveLayout.hidden.includes(key)}
                width={effectiveLayout.sizes[key]?.width ?? defaultStatsPanelSize(key).width}
                height={effectiveLayout.sizes[key]?.height ?? defaultStatsPanelSize(key).height}
                label={panelTitle(key, labels, t)}
                tone={effectiveLayout.tones[key] ?? "neutral"}
                onToneChange={(tone) => setTone(key, tone)}
                onResize={(axis, delta) => resizePanel(key, axis, delta)}
                onToggleVisibility={() => togglePanel(key)}
              >
                {renderPanel(key)}
              </SortablePanel>
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortablePanel({
  id,
  editMode,
  hidden,
  width,
  height,
  label,
  tone,
  onToneChange,
  onResize,
  onToggleVisibility,
  children,
}: {
  id: string;
  editMode: boolean;
  hidden: boolean;
  width: 1 | 2;
  height: 1 | 2;
  label: string;
  tone: StatTone;
  onToneChange: (tone: StatTone) => void;
  onResize: (axis: "width" | "height", delta: -1 | 1) => void;
  onToggleVisibility: () => void;
  children: React.ReactNode;
}) {
  const { t } = useLocale();
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id,
    disabled: !editMode,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex min-w-0 flex-col",
        width === 2 && "xl:col-span-2",
        height === 2 && "min-h-[38rem]",
        editMode && "rounded-lg outline outline-1 outline-dashed outline-border",
        hidden && "opacity-60",
      )}
    >
      {editMode && (
        <div className="bg-muted/30 mb-2 flex flex-wrap items-center gap-1 rounded-control border px-1 py-1">
          <DragHandle
            attributes={attributes}
            listeners={listeners}
            label={t("reorderStatisticsPanelAria", { name: label })}
          />
          <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium">{label}</span>
          <ToneSelect value={tone} label={label} onChange={onToneChange} />
          <IconButton
            label={hidden ? t("showStatisticsPanel") : t("hideStatisticsPanel")}
            variant="ghost"
            size="icon-sm"
            onClick={onToggleVisibility}
          >
            {hidden ? <EyeIcon aria-hidden="true" /> : <EyeOffIcon aria-hidden="true" />}
          </IconButton>
          <IconButton
            label={t("decreasePanelWidth")}
            variant="ghost"
            size="icon-sm"
            disabled={width === 1}
            onClick={() => onResize("width", -1)}
          >
            <ArrowLeftIcon aria-hidden="true" />
          </IconButton>
          <IconButton
            label={t("increasePanelWidth")}
            variant="ghost"
            size="icon-sm"
            disabled={width === 2}
            onClick={() => onResize("width", 1)}
          >
            <ArrowRightIcon aria-hidden="true" />
          </IconButton>
          <IconButton
            label={t("decreasePanelHeight")}
            variant="ghost"
            size="icon-sm"
            disabled={height === 1}
            onClick={() => onResize("height", -1)}
          >
            <ArrowUpIcon aria-hidden="true" />
          </IconButton>
          <IconButton
            label={t("increasePanelHeight")}
            variant="ghost"
            size="icon-sm"
            disabled={height === 2}
            onClick={() => onResize("height", 1)}
          >
            <ArrowDownIcon aria-hidden="true" />
          </IconButton>
        </div>
      )}
      {children}
    </div>
  );
}

function ToneSelect({
  value,
  label,
  onChange,
}: {
  value: StatTone;
  label: string;
  onChange: (tone: StatTone) => void;
}) {
  const { t } = useLocale();
  const toneLabels: Record<StatTone, MessageKey> = {
    neutral: "statisticsColorNeutral",
    success: "statisticsColorSuccess",
    danger: "statisticsColorDanger",
    warning: "statisticsColorWarning",
    info: "statisticsColorInfo",
  };
  const dotClass: Record<StatTone, string> = {
    neutral: "bg-muted-foreground",
    success: "bg-success",
    danger: "bg-destructive",
    warning: "bg-warning",
    info: "bg-info",
  };
  return (
    <Select value={value} onValueChange={(next) => onChange(next as StatTone)}>
      <SelectTrigger
        size="sm"
        className="h-7 w-9 gap-0 px-1.5"
        aria-label={t("statisticsColorFor", { name: label })}
      >
        <span className={cn("size-3 rounded-full", dotClass[value])} aria-hidden="true" />
        <SelectValue className="sr-only" />
      </SelectTrigger>
      <SelectContent align="end">
        {STAT_TONES.map((tone) => (
          <SelectItem key={tone} value={tone}>
            <span className="flex items-center gap-2">
              <span className={cn("size-3 rounded-full", dotClass[tone])} aria-hidden="true" />
              {t(toneLabels[tone])}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function buildDistributionDefinitions(
  stats: ApplicationStats | null,
  language: "en" | "es" | "gl",
  t: Translate,
): DistributionDefinition[] {
  if (!stats) return [];
  const hasPanel = (key: string) => stats.panel_keys?.includes(key) === true;
  const dateLabel = (bucket: string) =>
    new Intl.DateTimeFormat(LOCALE_CODES[language], { day: "numeric", month: "short" }).format(
      new Date(`${bucket}T00:00:00Z`),
    );
  const definitions: DistributionDefinition[] = [];
  if (stats.shirt_sizes_confirmed) {
    definitions.push({
      key: "shirt-sizes",
      title: t("shirtSizeDistribution"),
      defaultChart: "bar",
      rows: stats.shirt_sizes_confirmed.map((row) => ({ label: row.value, n: row.n })),
    });
  }
  if (stats.food_intolerances_confirmed) {
    definitions.push({
      key: "food-intolerances",
      title: t("dietaryDistribution"),
      defaultChart: "bar",
      rows: stats.food_intolerances_confirmed.map((row) => ({
        label: pickText(row.label, language),
        n: row.n,
      })),
    });
  }
  const series = stats.time_series;
  if (series?.submissions_by_day !== undefined || hasPanel("applications-over-time")) {
    definitions.push({
      key: "applications-over-time",
      title: t("applicationsOverTime"),
      defaultChart: "line",
      rows: (series?.submissions_by_day ?? []).map((row) => ({
        label: dateLabel(row.bucket),
        n: row.n,
      })),
    });
  }
  if (series?.confirmations_by_day !== undefined || hasPanel("confirmations-over-time")) {
    definitions.push({
      key: "confirmations-over-time",
      title: t("confirmationsOverTime"),
      defaultChart: "line",
      rows: (series?.confirmations_by_day ?? []).map((row) => ({
        label: dateLabel(row.bucket),
        n: row.n,
      })),
    });
  }
  if (series?.submissions_by_hour_of_day !== undefined || hasPanel("applications-by-hour")) {
    definitions.push({
      key: "applications-by-hour",
      title: t("submissionsByHour"),
      defaultChart: "line",
      rows: (series?.submissions_by_hour_of_day ?? []).map((row) => ({
        label: String(row.hour).padStart(2, "0"),
        n: row.n,
      })),
    });
  }
  if (series?.submissions_by_day_of_week !== undefined || hasPanel("applications-by-day-of-week")) {
    definitions.push({
      key: "applications-by-day-of-week",
      title: t("submissionsByDay"),
      defaultChart: "line",
      rows: (series?.submissions_by_day_of_week ?? []).map((row) => ({
        label: new Intl.DateTimeFormat(LOCALE_CODES[language], { weekday: "short" }).format(
          new Date(Date.UTC(2024, 0, 7 + row.dow)),
        ),
        n: row.n,
      })),
    });
  }
  for (const distribution of stats.field_distributions ?? []) {
    const key = `field:${distribution.field.key.toLowerCase()}`;
    const labels = new Map(
      distribution.field.options.map((option) => [option.value, pickText(option.label, language)]),
    );
    definitions.push({
      key,
      title: distribution.field.statistics?.label
        ? pickText(distribution.field.statistics.label, language)
        : distribution.field.statistics?.transformation === "age"
          ? t("ageDistribution")
          : distribution.field.statistics?.transformation === "study_level"
            ? t("studyLevelDistribution")
            : pickText(distribution.field.label, language),
      defaultChart:
        distribution.field.statistics?.visualization ??
        defaultStatsChartType(key, distribution.field.kind),
      rows: distribution.buckets.map((bucket) => ({
        label: statisticsBucketLabel(
          bucket.value,
          distribution.field.statistics?.transformation,
          labels.get(bucket.value),
          t,
        ),
        n: bucket.n,
      })),
    });
  }
  return definitions;
}

function statisticsBucketLabel(
  value: string,
  transformation: "none" | "age" | "study_level" | undefined,
  optionLabel: string | undefined,
  t: Translate,
): string {
  if (optionLabel) return optionLabel;
  if (value === "total") return t("statisticsTotal");
  if (value === "average") return t("statisticsAverage");
  if (value === "true") return t("booleanYes");
  if (value === "false") return t("booleanNo");
  if (transformation === "age") return t("ageYearsLabel", { value });
  if (transformation === "study_level") {
    const labels: Record<string, MessageKey> = {
      final_year: "studyLevelFinalYear",
      year_3: "studyLevelThirdYear",
      year_2: "studyLevelSecondYear",
      year_1: "studyLevelFirstYear",
      other: "studyLevelOther",
    };
    return labels[value] ? t(labels[value]) : value;
  }
  return value;
}

function OverviewPanel({
  stats,
  loading,
  error,
  onRetry,
  editMode,
  tone,
  kpiTones,
  onToneChange,
}: {
  stats: ApplicationStats | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  editMode: boolean;
  tone: StatTone;
  kpiTones: Record<string, StatTone>;
  onToneChange: (key: string, tone: StatTone) => void;
}) {
  const { t } = useLocale();
  const confirmed = stats?.overview?.confirmed ?? stats?.funnel?.confirmed;
  const submitted =
    stats?.overview?.submitted ??
    Object.entries(stats?.counts_by_status ?? {}).reduce(
      (total, [status, count]) => total + (status === "draft" ? 0 : count),
      0,
    );
  const overview = stats?.overview;
  const fallbackSent = stats?.funnel?.sent ?? 0;
  const rate =
    overview?.confirmation_rate != null
      ? Math.round(overview.confirmation_rate * 100)
      : confirmed === undefined || fallbackSent === 0
        ? null
        : Math.round((confirmed / fallbackSent) * 100);
  return (
    <SectionCard
      title={t("statisticsOverviewPanel")}
      icon={LayoutDashboardIcon}
      className={cn("h-full", statToneSurfaceClass[tone])}
    >
      {loading && !stats ? (
        <div
          className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
          role="status"
          aria-label={t("loading")}
        >
          {["submitted", "confirmed", "rejected", "rate", "pending", "expired", "able", "time"].map(
            (key) => (
              <Skeleton key={key} className="h-28 rounded-lg" />
            ),
          )}
        </div>
      ) : error && !stats ? (
        <div className="space-y-3 rounded-lg border border-destructive/30 p-5" role="alert">
          <p className="text-destructive text-pretty text-sm">{error}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            {t("retry")}
          </Button>
        </div>
      ) : !stats ? (
        <EmptyState
          icon={LayoutDashboardIcon}
          title={t("noApplicationStatistics")}
          action={
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t("retry")}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <StatCard
            label={t("submittedApplications")}
            value={submitted}
            icon={FileTextIcon}
            tone={kpiTones["overview:kpi:submitted"] ?? DEFAULT_OVERVIEW_TONES.submitted}
            action={
              editMode && (
                <ToneSelect
                  value={kpiTones["overview:kpi:submitted"] ?? DEFAULT_OVERVIEW_TONES.submitted}
                  label={t("submittedApplications")}
                  onChange={(next) => onToneChange("overview:kpi:submitted", next)}
                />
              )
            }
            className="h-full"
          />
          <StatCard
            label={t("confirmed")}
            value={confirmed ?? "—"}
            icon={BadgeCheckIcon}
            tone={kpiTones["overview:kpi:confirmed"] ?? DEFAULT_OVERVIEW_TONES.confirmed}
            action={
              editMode && (
                <ToneSelect
                  value={kpiTones["overview:kpi:confirmed"] ?? DEFAULT_OVERVIEW_TONES.confirmed}
                  label={t("confirmed")}
                  onChange={(next) => onToneChange("overview:kpi:confirmed", next)}
                />
              )
            }
            className="h-full"
          />
          <StatCard
            label={t("rejected")}
            value={overview?.rejected ?? "—"}
            icon={ShieldXIcon}
            tone={kpiTones["overview:kpi:rejected"] ?? DEFAULT_OVERVIEW_TONES.rejected}
            action={
              editMode && (
                <ToneSelect
                  value={kpiTones["overview:kpi:rejected"] ?? DEFAULT_OVERVIEW_TONES.rejected}
                  label={t("rejected")}
                  onChange={(next) => onToneChange("overview:kpi:rejected", next)}
                />
              )
            }
            className="h-full"
          />
          <StatCard
            label={t("confirmationRate")}
            value={rate === null ? "—" : `${rate}%`}
            icon={BadgeCheckIcon}
            tone={kpiTones["overview:kpi:rate"] ?? DEFAULT_OVERVIEW_TONES.rate}
            action={
              editMode && (
                <ToneSelect
                  value={kpiTones["overview:kpi:rate"] ?? DEFAULT_OVERVIEW_TONES.rate}
                  label={t("confirmationRate")}
                  onChange={(next) => onToneChange("overview:kpi:rate", next)}
                />
              )
            }
            className="h-full"
          />
          <StatCard
            label={t("expiredConfirmations")}
            value={overview?.expired_confirmations ?? "—"}
            icon={TimerOffIcon}
            tone={kpiTones["overview:kpi:expired"] ?? DEFAULT_OVERVIEW_TONES.expired}
            action={
              editMode && (
                <ToneSelect
                  value={kpiTones["overview:kpi:expired"] ?? DEFAULT_OVERVIEW_TONES.expired}
                  label={t("expiredConfirmations")}
                  onChange={(next) => onToneChange("overview:kpi:expired", next)}
                />
              )
            }
            className="h-full"
          />
          <StatCard
            label={t("stillAbleToConfirm")}
            value={overview?.still_able_to_confirm ?? "—"}
            icon={HourglassIcon}
            tone={kpiTones["overview:kpi:available"] ?? DEFAULT_OVERVIEW_TONES.available}
            action={
              editMode && (
                <ToneSelect
                  value={kpiTones["overview:kpi:available"] ?? DEFAULT_OVERVIEW_TONES.available}
                  label={t("stillAbleToConfirm")}
                  onChange={(next) => onToneChange("overview:kpi:available", next)}
                />
              )
            }
            className="h-full"
          />
          <StatCard
            label={t("averageConfirmationTime")}
            value={hours(
              overview?.average_confirmation_time_hours ?? stats?.time_to_confirm_hours?.avg,
              t,
            )}
            hint={`${t("medianConfirmationTime")}: ${hours(stats?.time_to_confirm_hours?.median, t)}`}
            icon={Clock3Icon}
            tone={kpiTones["overview:kpi:time"] ?? DEFAULT_OVERVIEW_TONES.time}
            action={
              editMode && (
                <ToneSelect
                  value={kpiTones["overview:kpi:time"] ?? DEFAULT_OVERVIEW_TONES.time}
                  label={t("averageConfirmationTime")}
                  onChange={(next) => onToneChange("overview:kpi:time", next)}
                />
              )
            }
            className="h-full sm:col-span-2 lg:col-span-1 xl:col-span-2"
          />
        </div>
      )}
    </SectionCard>
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
  chartType,
  onChartTypeChange,
  tone,
}: {
  title: string;
  rows: StatsChartDatum[];
  chartType: StatsChartType;
  onChartTypeChange: (chartType: StatsChartType) => void;
  tone: StatTone;
}) {
  const { t } = useLocale();
  return (
    <SectionCard
      title={title}
      className={cn("h-full", statToneSurfaceClass[tone])}
      action={
        <Select
          value={chartType}
          onValueChange={(value) => onChartTypeChange(value as StatsChartType)}
        >
          <SelectTrigger size="sm" className="w-28" aria-label={t("selectChartTypeFor", { title })}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="bar">
              <span className="flex items-center gap-2">
                <BarChart3Icon aria-hidden="true" />
                {t("chartTypeBar")}
              </span>
            </SelectItem>
            <SelectItem value="pie">
              <span className="flex items-center gap-2">
                <PieChartIcon aria-hidden="true" />
                {t("chartTypePie")}
              </span>
            </SelectItem>
            <SelectItem value="line">
              <span className="flex items-center gap-2">
                <LineChartIcon aria-hidden="true" />
                {t("chartTypeLine")}
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
      }
    >
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-pretty text-sm">{t("noDistributionData")}</p>
      ) : (
        <StatsChart data={rows} type={chartType} title={title} />
      )}
    </SectionCard>
  );
}
