import type { StatsChartType } from "./stats-chart";

const CHART_TYPES: StatsChartType[] = ["bar", "pie", "line"];

export interface StatsSection {
  id: string;
  title: string;
  panelKeys: string[];
}

export interface StatsLayoutConfig {
  order: string[];
  hidden: string[];
  charts: Record<string, StatsChartType>;
  sections: StatsSection[];
}

export function defaultStatsChartType(panelKey: string, fieldKind?: string): StatsChartType {
  if (panelKey.includes("by-day") || panelKey.includes("by-hour") || panelKey.includes("by-dow")) {
    return "line";
  }
  if (fieldKind === "checkbox") return "pie";
  return "bar";
}

export function sanitizeStatsLayout(raw: unknown, availablePanelKeys: string[]): StatsLayoutConfig {
  const available = new Set(availablePanelKeys);
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawOrder = Array.isArray(value.order) ? value.order : [];
  const order = [
    ...rawOrder.filter((key): key is string => typeof key === "string" && available.has(key)),
    ...availablePanelKeys.filter((key) => !rawOrder.includes(key)),
  ].filter((key, index, all) => all.indexOf(key) === index);
  const hidden = Array.isArray(value.hidden)
    ? value.hidden.filter((key): key is string => typeof key === "string" && available.has(key))
    : [];
  const charts: Record<string, StatsChartType> = {};
  if (value.charts && typeof value.charts === "object") {
    for (const [key, chart] of Object.entries(value.charts as Record<string, unknown>)) {
      if (available.has(key) && CHART_TYPES.includes(chart as StatsChartType)) {
        charts[key] = chart as StatsChartType;
      }
    }
  }
  const sections = Array.isArray(value.sections)
    ? value.sections.flatMap((section): StatsSection[] => {
        if (!section || typeof section !== "object") return [];
        const item = section as Record<string, unknown>;
        if (typeof item.id !== "string" || typeof item.title !== "string") return [];
        const panelKeys = Array.isArray(item.panelKeys)
          ? item.panelKeys.filter(
              (key): key is string => typeof key === "string" && available.has(key),
            )
          : [];
        return [{ id: item.id, title: item.title, panelKeys }];
      })
    : [];
  return {
    order,
    hidden: [...new Set(hidden)],
    charts,
    sections,
  };
}
