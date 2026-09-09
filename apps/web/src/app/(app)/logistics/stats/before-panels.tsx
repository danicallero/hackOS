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
  BarChart3Icon,
  EyeIcon,
  EyeOffIcon,
  LayoutDashboardIcon,
  LineChartIcon,
  PieChartIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Column, DataTable } from "@/components/common/data-table";
import { DragHandle } from "@/components/common/drag-handle";
import { IconButton } from "@/components/common/icon-button";
import { SectionCard } from "@/components/common/section-card";
import { StatCard } from "@/components/common/stat-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LOCALE_CODES, type MessageKey, pickText, type Translate, useLocale } from "@/lib/i18n";
import { uiPrefsApi } from "@/lib/logistics";
import { cn } from "@/lib/utils";
import { type ApplicationStats, applicationStatusLabel } from "./model";
import { StatsChart, type StatsChartDatum, type StatsChartType } from "./stats-chart";
import { defaultStatsChartType, type StatsLayoutConfig, sanitizeStatsLayout } from "./stats-layout";

const STORAGE_KEY = "hackos:applicationStatsLayouts:v1";

interface DistributionDefinition {
  key: string;
  title: string;
  rows: StatsChartDatum[];
  defaultChart: StatsChartType;
}

const BASE_PANEL_LABELS: Record<string, MessageKey> = {
  overview: "statisticsOverviewPanel",
  funnel: "applicationFunnel",
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
  if (stats.funnel !== undefined) keys.push("funnel");
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
    const current = effectiveLayout.sizes[key] ?? { width: 1, height: 1 };
    const nextValue = Math.max(1, Math.min(2, current[axis] + delta)) as 1 | 2;
    saveLayout({
      ...effectiveLayout,
      sizes: { ...effectiveLayout.sizes, [key]: { ...current, [axis]: nextValue } },
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
          onHide={() => togglePanel(key)}
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
        onChartTypeChange={(chartType) =>
          saveLayout({
            ...effectiveLayout,
            charts: { ...effectiveLayout.charts, [key]: chartType },
          })
        }
        onHide={() => togglePanel(key)}
      />
    );
  };

  return (
    <div className="space-y-5">
      {editMode && (
        <p className="text-muted-foreground text-pretty text-sm" role="status">
          {t("statisticsEditModeHint")}
        </p>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onPanelDragEnd}>
        <SortableContext items={renderedKeys} strategy={rectSortingStrategy}>
          <div className="grid auto-rows-[minmax(18rem,auto)] gap-4 xl:grid-cols-2">
            {renderedKeys.map((key) => (
              <SortablePanel
                key={key}
                id={key}
                editMode={editMode}
                hidden={effectiveLayout.hidden.includes(key)}
                width={effectiveLayout.sizes[key]?.width ?? 1}
                height={effectiveLayout.sizes[key]?.height ?? 1}
                label={panelTitle(key, labels, t)}
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
        "min-w-0",
        width === 2 && "xl:col-span-2",
        height === 2 && "xl:row-span-2",
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
  if (stats.funnel) {
    definitions.push({
      key: "funnel",
      title: t("applicationFunnel"),
      defaultChart: "bar",
      rows: [
        { label: t("pendingConfirmation"), n: stats.funnel.still_in_window },
        { label: t("confirmed"), n: stats.funnel.confirmed },
        { label: t("declined"), n: stats.funnel.declined },
        { label: t("dataStatusExpired"), n: stats.funnel.expired },
      ],
    });
  }
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
  onHide,
}: {
  stats: ApplicationStats | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onHide: () => void;
}) {
  const { t } = useLocale();
  const statusRows = Object.entries(stats?.counts_by_status ?? {}).map(([status, count]) => ({
    status,
    count,
  }));
  const statusColumns: Column<(typeof statusRows)[number]>[] = [
    {
      id: "status",
      header: t("statusColumn"),
      cell: (row) => applicationStatusLabel(row.status, t),
      sortValue: (row) => row.status,
    },
    {
      id: "count",
      header: t("columnPeople"),
      align: "right",
      cell: (row) => row.count,
      sortValue: (row) => row.count,
    },
  ];
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
      action={
        <IconButton label={t("hideStatisticsPanel")} variant="ghost" onClick={onHide}>
          <EyeOffIcon aria-hidden="true" />
        </IconButton>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("submittedApplications")} value={submitted} />
        <StatCard label={t("confirmed")} value={confirmed ?? "—"} />
        <StatCard label={t("rejected")} value={overview?.rejected ?? "—"} />
        <StatCard label={t("confirmationRate")} value={rate === null ? "—" : `${rate}%`} />
        <StatCard
          label={t("expiredConfirmations")}
          value={overview?.expired_confirmations ?? "—"}
        />
        <StatCard label={t("stillAbleToConfirm")} value={overview?.still_able_to_confirm ?? "—"} />
        <StatCard
          label={t("averageConfirmationTime")}
          value={hours(
            overview?.average_confirmation_time_hours ?? stats?.time_to_confirm_hours?.avg,
            t,
          )}
          hint={`${t("medianConfirmationTime")}: ${hours(stats?.time_to_confirm_hours?.median, t)}`}
        />
      </div>
      <DataTable
        columns={statusColumns}
        data={statusRows}
        getRowId={(row) => row.status}
        loading={loading}
        error={error ? { message: error, onRetry } : undefined}
        empty={{ icon: LayoutDashboardIcon, title: t("noApplicationStatistics") }}
      />
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
  onHide,
}: {
  title: string;
  rows: StatsChartDatum[];
  chartType: StatsChartType;
  onChartTypeChange: (chartType: StatsChartType) => void;
  onHide: () => void;
}) {
  const { t } = useLocale();
  return (
    <SectionCard
      title={title}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={chartType}
            onValueChange={(value) => onChartTypeChange(value as StatsChartType)}
          >
            <SelectTrigger
              size="sm"
              className="w-28"
              aria-label={t("selectChartTypeFor", { title })}
            >
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
          <IconButton
            label={t("hideStatisticsPanel")}
            variant="ghost"
            size="icon-sm"
            onClick={onHide}
          >
            <EyeOffIcon aria-hidden="true" />
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
  );
}
