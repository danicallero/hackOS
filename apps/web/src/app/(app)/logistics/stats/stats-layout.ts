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
  sizes: Record<string, { width: 1 | 2; height: 1 | 2 }>;
}

export function defaultStatsPanelSize(panelKey: string): { width: 1 | 2; height: 1 | 2 } {
  return { width: panelKey === "overview" ? 2 : 1, height: 1 };
}

export function defaultStatsChartType(panelKey: string, fieldKind?: string): StatsChartType {
  if (
    panelKey.includes("by-day") ||
    panelKey.includes("by-hour") ||
    panelKey.includes("by-dow") ||
    panelKey.includes("over-time") ||
    panelKey === "applications-by-day-of-week"
  ) {
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
  const sizes: Record<string, { width: 1 | 2; height: 1 | 2 }> = {};
  if (value.sizes && typeof value.sizes === "object") {
    for (const [key, rawSize] of Object.entries(value.sizes as Record<string, unknown>)) {
      if (!available.has(key) || !rawSize || typeof rawSize !== "object") continue;
      const size = rawSize as Record<string, unknown>;
      sizes[key] = {
        width: size.width === 2 ? 2 : 1,
        height: size.height === 2 ? 2 : 1,
      };
    }
  }
  for (const key of availablePanelKeys) sizes[key] ??= defaultStatsPanelSize(key);
  return {
    order,
    hidden: [...new Set(hidden)],
    charts,
    sections,
    sizes,
  };
}
