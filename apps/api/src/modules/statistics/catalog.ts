/**
 * H27 statistics catalog.  A panel definition is deliberately independent of
 * a particular application form: the dashboard can use the same panel for an
 * application scope, a role scope, or an aggregate of compatible scopes.
 */

export type StatisticsScopeKind = "application" | "role";

export type StatisticsPanelDataKind = "metrics" | "funnel" | "series" | "distribution";

export interface StatisticsPanelDefinition {
  key: string;
  dataKind: StatisticsPanelDataKind;
  supportedScopeKinds: readonly StatisticsScopeKind[];
  supportsMultipleScopes: boolean;
  supportsAggregation: boolean;
}

export const STATISTICS_BASE_PANEL_KEYS = [
  "overview",
  "funnel",
  "applications-over-time",
  "confirmations-over-time",
  "applications-by-hour",
  "applications-by-day-of-week",
  "shirt-sizes",
  "food-intolerances",
] as const;

/**
 * These aliases are accepted when reading old ACLs/layouts.  New responses
 * use the descriptive panel ids above so the rename from Application
 * Evolution does not create two visualizations for the same series.
 */
export const LEGACY_STATISTICS_PANEL_ALIASES: Record<string, string> = {
  "submissions-by-day": "applications-over-time",
  "confirmations-by-day": "confirmations-over-time",
  "submissions-by-hour": "applications-by-hour",
  "submissions-by-dow": "applications-by-day-of-week",
};

export function canonicalStatisticsPanelKey(key: string): string {
  return LEGACY_STATISTICS_PANEL_ALIASES[key] ?? key;
}

export const STATISTICS_PANEL_CATALOG: readonly StatisticsPanelDefinition[] = [
  {
    key: "overview",
    dataKind: "metrics",
    supportedScopeKinds: ["application"],
    supportsMultipleScopes: true,
    supportsAggregation: true,
  },
  {
    key: "funnel",
    dataKind: "funnel",
    supportedScopeKinds: ["application"],
    supportsMultipleScopes: true,
    supportsAggregation: true,
  },
  {
    key: "applications-over-time",
    dataKind: "series",
    supportedScopeKinds: ["application"],
    supportsMultipleScopes: true,
    supportsAggregation: true,
  },
  {
    key: "confirmations-over-time",
    dataKind: "series",
    supportedScopeKinds: ["application"],
    supportsMultipleScopes: true,
    supportsAggregation: true,
  },
  {
    key: "applications-by-hour",
    dataKind: "series",
    supportedScopeKinds: ["application"],
    supportsMultipleScopes: true,
    supportsAggregation: true,
  },
  {
    key: "applications-by-day-of-week",
    dataKind: "series",
    supportedScopeKinds: ["application"],
    supportsMultipleScopes: true,
    supportsAggregation: true,
  },
  {
    key: "shirt-sizes",
    dataKind: "distribution",
    supportedScopeKinds: ["application", "role"],
    supportsMultipleScopes: true,
    supportsAggregation: true,
  },
  {
    key: "food-intolerances",
    dataKind: "distribution",
    supportedScopeKinds: ["application", "role"],
    supportsMultipleScopes: true,
    supportsAggregation: true,
  },
];

/** Role scopes intentionally start with only datasets that are meaningful for
 * every user record. Form-question panels stay attached to their form scope,
 * where their configured options and transformations are available. */
export const ROLE_SCOPE_PANEL_KEYS = ["shirt-sizes", "food-intolerances"] as const;

export function panelDefinition(key: string): StatisticsPanelDefinition | undefined {
  return STATISTICS_PANEL_CATALOG.find((panel) => panel.key === canonicalStatisticsPanelKey(key));
}

export function panelSupportsScope(key: string, scopeKind: StatisticsScopeKind): boolean {
  return (
    panelDefinition(key)?.supportedScopeKinds.includes(scopeKind) ??
    (key.startsWith("field:") && scopeKind === "application")
  );
}

export function isCompatibleStatisticsPanel(
  key: string,
  scopeKinds: StatisticsScopeKind[],
): boolean {
  if (scopeKinds.length === 0) return false;
  if (key.startsWith("field:")) return scopeKinds.every((kind) => kind === "application");
  const definition = panelDefinition(key);
  return Boolean(
    definition && scopeKinds.some((kind) => definition.supportedScopeKinds.includes(kind)),
  );
}
