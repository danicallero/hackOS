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
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  BarChart3Icon,
  EyeOffIcon,
  GripVerticalIcon,
  LayoutDashboardIcon,
  LineChartIcon,
  PieChartIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Column, DataTable } from "@/components/common/data-table";
import { DragHandle, SortableItem } from "@/components/common/drag-handle";
import { IconButton } from "@/components/common/icon-button";
import { Modal } from "@/components/common/modal";
import { SectionCard } from "@/components/common/section-card";
import { StatCard } from "@/components/common/stat-card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LOCALE_CODES, type MessageKey, pickText, type Translate, useLocale } from "@/lib/i18n";
import { uiPrefsApi } from "@/lib/logistics";
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
  "submissions-by-day": "submissionEvolution",
  "confirmations-by-day": "confirmationEvolution",
  "submissions-by-hour": "submissionsByHour",
  "submissions-by-dow": "submissionsByDay",
};

function panelKeysForStats(stats: ApplicationStats | null): string[] {
  if (!stats) return ["overview"];
  const keys: string[] = [];
  if (stats.counts_by_status !== undefined) keys.push("overview");
  if (stats.funnel !== undefined) keys.push("funnel");
  if (stats.shirt_sizes_confirmed !== undefined) keys.push("shirt-sizes");
  if (stats.food_intolerances_confirmed !== undefined) keys.push("food-intolerances");
  if (stats.time_series?.submissions_by_day !== undefined) keys.push("submissions-by-day");
  if (stats.time_series?.confirmations_by_day !== undefined) keys.push("confirmations-by-day");
  if (stats.time_series?.submissions_by_hour_of_day !== undefined) keys.push("submissions-by-hour");
  if (stats.time_series?.submissions_by_day_of_week !== undefined) keys.push("submissions-by-dow");
  for (const field of stats.field_distributions ?? [])
    keys.push(`field:${field.field.key.toLowerCase()}`);
  return keys;
}

function panelTitle(key: string, labels: Map<string, string>, t: Translate): string {
  const base = BASE_PANEL_LABELS[key];
  return base ? t(base) : (labels.get(key) ?? key.replace(/^field:/, "").replaceAll(/[-_.]/g, " "));
}

function readLocalLayout(applicationId: number): unknown {
  try {
    const raw = JSON.parse(localStorage.getItem(`${STORAGE_KEY}:${applicationId}`) ?? "null");
    return raw;
  } catch {
    return null;
  }
}

function writeLocalLayout(applicationId: number, layout: StatsLayoutConfig): void {
  try {
    localStorage.setItem(`${STORAGE_KEY}:${applicationId}`, JSON.stringify(layout));
  } catch {
    // localStorage is an acceleration only; the account preference remains authoritative.
  }
}

export function BeforePanels({
  applicationId,
  stats,
  loading,
  error,
  onRetry,
}: {
  applicationId: number | null;
  stats: ApplicationStats | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const { language, t } = useLocale();
  const availablePanelKeys = useMemo(() => panelKeysForStats(stats), [stats]);
  const [layout, setLayout] = useState<StatsLayoutConfig>(() =>
    sanitizeStatsLayout(null, ["overview"]),
  );
  const loadedApplication = useRef<number | null>(null);
  const availablePanelKeysRef = useRef(availablePanelKeys);
  availablePanelKeysRef.current = availablePanelKeys;
  const rawLayouts = useRef<Record<string, unknown>>({});
  const storedLayouts = useRef<Record<string, unknown>>({});

  useEffect(() => {
    if (!applicationId || loadedApplication.current === applicationId) return;
    loadedApplication.current = applicationId;
    const local = readLocalLayout(applicationId);
    rawLayouts.current[String(applicationId)] = local;
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
        const remote = remoteStore[String(applicationId)] ?? prefs.applicationStatsPanels;
        if (remote) {
          rawLayouts.current[String(applicationId)] = remote;
          const next = sanitizeStatsLayout(remote, availablePanelKeysRef.current);
          setLayout(next);
          writeLocalLayout(applicationId, next);
        }
      })
      .catch(() => {
        // The local copy keeps the dashboard usable while offline.
      });
    return () => {
      active = false;
    };
  }, [applicationId]);

  useEffect(() => {
    if (!applicationId) return;
    const raw = rawLayouts.current[String(applicationId)];
    if (raw !== undefined) setLayout(sanitizeStatsLayout(raw, availablePanelKeys));
  }, [applicationId, availablePanelKeys]);

  const effectiveLayout = useMemo(
    () => sanitizeStatsLayout(layout, availablePanelKeys),
    [availablePanelKeys, layout],
  );
  const labels = useMemo(
    () =>
      new Map(
        (stats?.field_distributions ?? []).map((distribution) => [
          `field:${distribution.field.key.toLowerCase()}`,
          pickText(distribution.field.label, language),
        ]),
      ),
    [language, stats?.field_distributions],
  );

  const saveLayout = useCallback(
    (next: StatsLayoutConfig) => {
      setLayout(next);
      if (!applicationId) return;
      rawLayouts.current[String(applicationId)] = next;
      writeLocalLayout(applicationId, next);
      const nextStore = { ...storedLayouts.current, [String(applicationId)]: next };
      storedLayouts.current = nextStore;
      void uiPrefsApi.set("applicationStatsLayouts", nextStore).catch(() => {});
    },
    [applicationId],
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
  const groupedKeys = new Set(effectiveLayout.sections.flatMap((section) => section.panelKeys));
  const unsectioned = visibleKeys.filter((key) => !groupedKeys.has(key));

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
      <div className="flex justify-end">
        <StatsLayoutControls
          layout={effectiveLayout}
          panelKeys={effectiveLayout.order}
          panelLabels={
            new Map(effectiveLayout.order.map((key) => [key, panelTitle(key, labels, t)]))
          }
          onChange={saveLayout}
        />
      </div>
      {effectiveLayout.sections.map((section) => {
        const keys = visibleKeys.filter((key) => section.panelKeys.includes(key));
        if (keys.length === 0) return null;
        return (
          <section
            key={section.id}
            aria-labelledby={`stats-section-${section.id}`}
            className="space-y-3"
          >
            <h2 id={`stats-section-${section.id}`} className="type-section-title text-balance">
              {section.title}
            </h2>
            <div className="grid gap-4 xl:grid-cols-2">{keys.map(renderPanel)}</div>
          </section>
        );
      })}
      {unsectioned.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-2">{unsectioned.map(renderPanel)}</div>
      )}
    </div>
  );
}

function buildDistributionDefinitions(
  stats: ApplicationStats | null,
  language: "en" | "es" | "gl",
  t: Translate,
): DistributionDefinition[] {
  if (!stats) return [];
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
        { label: t("decisionsSent"), n: stats.funnel.sent },
        { label: t("dataStatusAccepted"), n: stats.funnel.still_in_window },
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
  if (series?.submissions_by_day !== undefined) {
    definitions.push({
      key: "submissions-by-day",
      title: t("submissionEvolution"),
      defaultChart: "line",
      rows: series.submissions_by_day.map((row) => ({ label: dateLabel(row.bucket), n: row.n })),
    });
  }
  if (series?.confirmations_by_day !== undefined) {
    definitions.push({
      key: "confirmations-by-day",
      title: t("confirmationEvolution"),
      defaultChart: "line",
      rows: series.confirmations_by_day.map((row) => ({ label: dateLabel(row.bucket), n: row.n })),
    });
  }
  if (series?.submissions_by_hour_of_day !== undefined) {
    definitions.push({
      key: "submissions-by-hour",
      title: t("submissionsByHour"),
      defaultChart: "line",
      rows: series.submissions_by_hour_of_day.map((row) => ({
        label: String(row.hour).padStart(2, "0"),
        n: row.n,
      })),
    });
  }
  if (series?.submissions_by_day_of_week !== undefined) {
    definitions.push({
      key: "submissions-by-dow",
      title: t("submissionsByDay"),
      defaultChart: "line",
      rows: series.submissions_by_day_of_week.map((row) => ({
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
      title: pickText(distribution.field.label, language),
      defaultChart: defaultStatsChartType(key, distribution.field.kind),
      rows: distribution.buckets.map((bucket) => ({
        label:
          labels.get(bucket.value) ??
          (bucket.value === "true"
            ? t("booleanYes")
            : bucket.value === "false"
              ? t("booleanNo")
              : bucket.value),
        n: bucket.n,
      })),
    });
  }
  return definitions;
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
  const sent = stats?.funnel?.sent ?? 0;
  const confirmed = stats?.funnel?.confirmed;
  const submitted = Object.entries(stats?.counts_by_status ?? {}).reduce(
    (total, [status, count]) => total + (status === "draft" ? 0 : count),
    0,
  );
  const rate = confirmed === undefined || sent === 0 ? null : Math.round((confirmed / sent) * 100);

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
        <StatCard label={t("confirmationRate")} value={rate === null ? "—" : `${rate}%`} />
        <StatCard
          label={t("averageConfirmationTime")}
          value={hours(stats?.time_to_confirm_hours?.avg, t)}
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

function StatsLayoutControls({
  layout,
  panelKeys,
  panelLabels,
  onChange,
}: {
  layout: StatsLayoutConfig;
  panelKeys: string[];
  panelLabels: Map<string, string>;
  onChange: (layout: StatsLayoutConfig) => void;
}) {
  const { t } = useLocale();
  const [createSectionOpen, setCreateSectionOpen] = useState(false);
  const [sectionName, setSectionName] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onPanelDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const from = panelKeys.indexOf(String(event.active.id));
    const to = panelKeys.indexOf(String(event.over.id));
    if (from === -1 || to === -1) return;
    onChange({ ...layout, order: arrayMove(layout.order, from, to) });
  }

  function onSectionDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    const from = layout.sections.findIndex((section) => section.id === event.active.id);
    const to = layout.sections.findIndex((section) => section.id === event.over?.id);
    if (from === -1 || to === -1) return;
    onChange({ ...layout, sections: arrayMove(layout.sections, from, to) });
  }

  function setVisible(panelKey: string, visible: boolean) {
    onChange({
      ...layout,
      hidden: visible
        ? layout.hidden.filter((key) => key !== panelKey)
        : [...layout.hidden, panelKey],
    });
  }

  function setSection(panelKey: string, sectionId: string) {
    onChange({
      ...layout,
      sections: layout.sections.map((section) => ({
        ...section,
        panelKeys:
          section.id === sectionId
            ? [...new Set([...section.panelKeys, panelKey])]
            : section.panelKeys.filter((key) => key !== panelKey),
      })),
    });
  }

  function createSection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = sectionName.trim();
    if (!title) return;
    const id = `section-${Date.now()}`;
    onChange({ ...layout, sections: [...layout.sections, { id, title, panelKeys: [] }] });
    setSectionName("");
    setCreateSectionOpen(false);
  }

  function deleteSection(id: string) {
    onChange({ ...layout, sections: layout.sections.filter((section) => section.id !== id) });
  }

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <GripVerticalIcon className="size-4" aria-hidden="true" />
            {t("customizeStatistics")}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="max-h-[min(70vh,36rem)] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto"
        >
          <div className="space-y-4">
            <div>
              <h2 className="font-medium text-sm text-balance">{t("statisticsPanels")}</h2>
              <p className="text-muted-foreground text-pretty text-xs">
                {t("statisticsPanelsHint")}
              </p>
            </div>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onPanelDragEnd}
            >
              <SortableContext items={panelKeys} strategy={verticalListSortingStrategy}>
                <div className="space-y-1">
                  {panelKeys.map((panelKey) => {
                    const visible = !layout.hidden.includes(panelKey);
                    const section = layout.sections.find((item) =>
                      item.panelKeys.includes(panelKey),
                    );
                    return (
                      <SortableItem key={panelKey} id={panelKey}>
                        {(drag) => (
                          <div className="flex items-center gap-1.5 rounded-md px-1 py-1">
                            <DragHandle
                              attributes={drag.attributes}
                              listeners={drag.listeners}
                              label={t("reorderStatisticsPanelAria", {
                                name: panelLabels.get(panelKey) ?? panelKey,
                              })}
                            />
                            <Checkbox
                              id={`stats-panel-${panelKey}`}
                              checked={visible}
                              onCheckedChange={(checked) => setVisible(panelKey, checked === true)}
                            />
                            <label
                              htmlFor={`stats-panel-${panelKey}`}
                              className="min-w-0 flex-1 truncate text-sm"
                            >
                              {panelLabels.get(panelKey) ?? panelKey}
                            </label>
                            <Select
                              value={section?.id ?? "__none"}
                              onValueChange={(value) =>
                                setSection(panelKey, value === "__none" ? "" : value)
                              }
                            >
                              <SelectTrigger
                                size="sm"
                                className="w-32"
                                aria-label={t("moveStatisticsPanelAria", {
                                  name: panelLabels.get(panelKey) ?? panelKey,
                                })}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none">{t("noStatisticsSection")}</SelectItem>
                                {layout.sections.map((item) => (
                                  <SelectItem key={item.id} value={item.id}>
                                    {item.title}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </SortableItem>
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-medium text-sm">{t("statisticsSections")}</h3>
                <Button variant="ghost" size="sm" onClick={() => setCreateSectionOpen(true)}>
                  <PlusIcon className="size-4" aria-hidden="true" />
                  {t("addStatisticsSection")}
                </Button>
              </div>
              {layout.sections.length > 0 ? (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={onSectionDragEnd}
                >
                  <SortableContext
                    items={layout.sections.map((section) => section.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-1">
                      {layout.sections.map((section) => (
                        <SortableItem key={section.id} id={section.id}>
                          {(drag) => (
                            <div className="flex items-center gap-1 rounded-md px-1 py-1">
                              <DragHandle
                                attributes={drag.attributes}
                                listeners={drag.listeners}
                                label={t("reorderStatisticsSectionAria", { name: section.title })}
                              />
                              <span className="min-w-0 flex-1 truncate text-sm">
                                {section.title}
                              </span>
                              <IconButton
                                label={t("removeStatisticsSection", { name: section.title })}
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => deleteSection(section.id)}
                              >
                                <Trash2Icon aria-hidden="true" />
                              </IconButton>
                            </div>
                          )}
                        </SortableItem>
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              ) : (
                <p className="text-muted-foreground text-pretty text-xs">
                  {t("noStatisticsSections")}
                </p>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
      <Modal
        open={createSectionOpen}
        onOpenChange={setCreateSectionOpen}
        title={t("addStatisticsSection")}
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateSectionOpen(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" form="statistics-section-form">
              {t("createStatisticsSection")}
            </Button>
          </>
        }
      >
        <form id="statistics-section-form" onSubmit={createSection} className="space-y-3">
          <label htmlFor="statistics-section-name" className="type-label">
            {t("statisticsSectionName")}
          </label>
          <Input
            id="statistics-section-name"
            value={sectionName}
            onChange={(event) => setSectionName(event.target.value)}
            autoFocus
          />
        </form>
      </Modal>
    </>
  );
}
