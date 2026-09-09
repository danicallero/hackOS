import { CAPABILITIES } from "@hackos/shared/capabilities";
import { pool, type Queryable } from "../../db/pool.js";
import { userHasCapability } from "../../lib/capabilities.js";
import { ForbiddenError } from "../../lib/errors.js";
import type { StatisticsConfig } from "../applications/schemas.js";
import type { ApplicationRow } from "../applications/service.js";
import {
  allowedStatisticsPanels,
  applicationStats,
  fieldPanelKey,
  resolveStatisticsPanelDecisions,
  statisticsPanelKeys,
} from "../applications/stats.js";
import {
  canonicalStatisticsPanelKey,
  isCompatibleStatisticsPanel,
  panelDefinition,
  ROLE_SCOPE_PANEL_KEYS,
  STATISTICS_PANEL_CATALOG,
  type StatisticsScopeKind,
} from "./catalog.js";

export interface StatisticsScope {
  key: string;
  kind: StatisticsScopeKind;
  id: number;
  name: string;
  panelKeys: string[];
}

interface InternalScope extends StatisticsScope {
  application?: ApplicationRow;
}

export interface StatisticsQuery {
  scopes: string[];
  panelKeys?: string[];
}

/**
 * The generic statistics resource key is intentionally explicit. It is used
 * by the API, UI preferences, and exports, which prevents a panel permission
 * from accidentally becoming a permission for an entire application.
 */
export function parseStatisticsScopeKey(key: string): {
  kind: StatisticsScopeKind;
  id: number;
} | null {
  const match = /^(application|role):(\d+)$/.exec(key);
  if (!match) return null;
  return { kind: match[1] as StatisticsScopeKind, id: Number(match[2]) };
}

export function statisticsScopeKey(kind: StatisticsScopeKind, id: number): string {
  return `${kind}:${id}`;
}

/** Role-scoped panel ACL, using the same position-ordered tri-state resolver
 * as application panel ACL. Missing rows are INHERIT and general Logistics
 * access supplies the fallback ALLOW. */
export async function allowedRoleStatisticsPanels(
  roleId: number,
  userId: number,
  generalAccess = false,
  db: Queryable = pool,
): Promise<Set<string>> {
  const { rows } = await db.query(
    `SELECT a.panel_key, a.state, r.position
       FROM statistics_scope_panel_role_access a
       JOIN user_roles ur ON ur.role_id = a.role_id AND ur.user_id = $2
       JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
      WHERE a.scope_key = $1 AND a.state <> 'inherit'
      ORDER BY a.panel_key, r.position DESC`,
    [statisticsScopeKey("role", roleId), userId],
  );
  const decisions = resolveStatisticsPanelDecisions(
    (rows as Array<{ panel_key: string; state: "allow" | "deny"; position: number }>).map(
      (row) => ({
        panelKey: row.panel_key,
        rolePosition: Number(row.position),
        state: row.state,
      }),
    ),
  );
  return new Set(
    ROLE_SCOPE_PANEL_KEYS.filter((panelKey) => {
      const explicit = decisions.get(panelKey);
      return explicit ? explicit === "allow" : generalAccess;
    }),
  );
}

/**
 * List only scopes that the caller can query. Managers see the full catalog;
 * general readers inherit non-denied application/role panels; panel-only
 * readers see precisely the scopes with an explicit allow.
 */
export async function accessibleStatisticsScopes(
  userId: number,
  request?: Parameters<typeof userHasCapability>[2],
): Promise<InternalScope[]> {
  const manages = await userHasCapability(userId, CAPABILITIES.STATISTICS_MANAGE, request);
  const generalAccess = await userHasCapability(userId, CAPABILITIES.LOGISTICS_STATS, request);

  const applications = await pool.query<ApplicationRow>(`SELECT * FROM applications ORDER BY id`);
  const applicationScopes = await Promise.all(
    applications.rows.map(async (application) => {
      const availablePanelKeys = statisticsPanelKeys(application.template);
      const panelKeys = manages
        ? availablePanelKeys
        : await allowedStatisticsPanels(application.id, userId, generalAccess);
      if (!manages && panelKeys.size === 0) return null;
      return {
        key: statisticsScopeKey("application", application.id),
        kind: "application" as const,
        id: application.id,
        name: application.name,
        panelKeys: [...panelKeys],
        application,
      } satisfies InternalScope;
    }),
  );

  const roles = await pool.query<{ id: number; name: string }>(
    `SELECT id, name FROM roles
      WHERE deleted_at IS NULL
      ORDER BY position DESC, id`,
  );
  const roleScopes = await Promise.all(
    roles.rows.map(async (role) => {
      const availablePanelKeys = new Set<string>(ROLE_SCOPE_PANEL_KEYS);
      const panelKeys = manages
        ? availablePanelKeys
        : await allowedRoleStatisticsPanels(role.id, userId, generalAccess);
      if (!manages && panelKeys.size === 0) return null;
      return {
        key: statisticsScopeKey("role", role.id),
        kind: "role" as const,
        id: role.id,
        name: role.name,
        panelKeys: [...panelKeys],
      } satisfies InternalScope;
    }),
  );

  return [...applicationScopes, ...roleScopes].filter((scope) => scope !== null) as InternalScope[];
}

export function publicStatisticsScope(scope: StatisticsScope): StatisticsScope {
  return {
    key: scope.key,
    kind: scope.kind,
    id: scope.id,
    name: scope.name,
    panelKeys: [...scope.panelKeys],
  };
}

function sumRows(rows: Array<{ value: string; n: number }>): Array<{ value: string; n: number }> {
  const totals = new Map<string, number>();
  for (const row of rows)
    totals.set(String(row.value), (totals.get(String(row.value)) ?? 0) + Number(row.n));
  return [...totals.entries()].map(([value, n]) => ({ value, n }));
}

function mergeBucketRows(
  left: Array<{ value: string; n: number }> | undefined,
  right: Array<{ value: string; n: number }> | undefined,
): Array<{ value: string; n: number }> {
  return sumRows([...(left ?? []), ...(right ?? [])]);
}

function mergeNamedRows<T extends { n: number }>(
  left: T[] | undefined,
  right: T[] | undefined,
  keyOf: (row: T) => string,
): T[] {
  const byKey = new Map<string, T>();
  for (const row of [...(left ?? []), ...(right ?? [])]) {
    const key = keyOf(row);
    const previous = byKey.get(key);
    byKey.set(key, previous ? { ...previous, n: Number(previous.n) + Number(row.n) } : row);
  }
  return [...byKey.values()];
}

function mergeSeries(
  left: Array<Record<string, unknown>> | undefined,
  right: Array<Record<string, unknown>> | undefined,
  keyOf: (row: Record<string, unknown>) => string,
): Array<Record<string, unknown>> {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const row of [...(left ?? []), ...(right ?? [])]) {
    const key = keyOf(row);
    const previous = byKey.get(key);
    byKey.set(
      key,
      previous ? { ...previous, n: Number(previous.n ?? 0) + Number(row.n ?? 0) } : row,
    );
  }
  return [...byKey.values()].sort((a, b) => {
    const left = keyOf(a);
    const right = keyOf(b);
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber - rightNumber;
    }
    return left.localeCompare(right);
  });
}

export function mergeApplicationSnapshots(
  snapshots: Record<string, unknown>[],
): Record<string, unknown> {
  const first = snapshots[0] ?? {};
  const counts = snapshots.reduce<Record<string, number>>((result, snapshot) => {
    for (const [status, count] of Object.entries(
      (snapshot.counts_by_status as Record<string, number> | undefined) ?? {},
    )) {
      result[status] = (result[status] ?? 0) + Number(count);
    }
    return result;
  }, {});
  const funnel = snapshots.reduce<Record<string, number>>((result, snapshot) => {
    for (const [key, value] of Object.entries(
      (snapshot.funnel as Record<string, number> | undefined) ?? {},
    )) {
      result[key] = (result[key] ?? 0) + Number(value);
    }
    return result;
  }, {});
  const timeSeriesKeys: Record<string, (row: Record<string, unknown>) => string> = {
    submissions_by_day: (row) => String(row.bucket),
    confirmations_by_day: (row) => String(row.bucket),
    submissions_by_hour_of_day: (row) => String(row.hour),
    submissions_by_day_of_week: (row) => String(row.dow),
  };
  const timeSeries = Object.fromEntries(
    Object.entries(timeSeriesKeys)
      .map(([key, keyOf]) => [
        key,
        mergeSeries(
          undefined,
          snapshots.flatMap(
            (snapshot) =>
              (
                snapshot.time_series as Record<string, Array<Record<string, unknown>>> | undefined
              )?.[key] ?? [],
          ),
          keyOf,
        ),
      ])
      .filter(([, rows]) => (rows as unknown[]).length > 0),
  );
  const timeValues = snapshots
    .map((snapshot) => {
      const time = snapshot.time_to_confirm_hours as
        | { avg?: number | null; count?: number }
        | undefined;
      return time?.avg == null ? null : { avg: Number(time.avg), count: Number(time.count ?? 0) };
    })
    .filter((value): value is { avg: number; count: number } => value !== null);
  const medianValues = snapshots
    .map(
      (snapshot) =>
        (snapshot.time_to_confirm_hours as Record<string, number | null> | undefined)?.median,
    )
    .filter((value): value is number => value != null);
  const distributions = new Map<
    string,
    { field: Record<string, unknown>; buckets: Array<{ value: string; n: number }> }
  >();
  for (const snapshot of snapshots) {
    for (const distribution of (snapshot.field_distributions as
      | Array<{
          field: Record<string, unknown>;
          buckets: Array<{ value: string; n: number }>;
        }>
      | undefined) ?? []) {
      const key = String(distribution.field.key).toLowerCase();
      const previous = distributions.get(key);
      distributions.set(key, {
        field: previous?.field ?? distribution.field,
        buckets: mergeBucketRows(previous?.buckets, distribution.buckets),
      });
    }
  }
  const shirt = mergeNamedRows(
    undefined,
    snapshots.flatMap(
      (snapshot) =>
        (snapshot.shirt_sizes_confirmed as Array<{ value: string; n: number }> | undefined) ?? [],
    ),
    (row) => String(row.value),
  );
  const food = mergeNamedRows(
    undefined,
    snapshots.flatMap(
      (snapshot) =>
        (snapshot.food_intolerances_confirmed as
          | Array<{
              intolerance_id: number;
              label: Record<string, string>;
              n: number;
            }>
          | undefined) ?? [],
    ),
    (row) => String(row.intolerance_id),
  );
  const submitted = Object.entries(counts).reduce(
    (total, [status, count]) => total + (status === "draft" ? 0 : count),
    0,
  );
  const confirmed = Number(funnel.confirmed ?? 0);
  const sent = Number(funnel.sent ?? 0);
  const overview = {
    submitted,
    confirmed,
    rejected: Number(funnel.rejected ?? counts.rejected ?? 0),
    expired_confirmations: Number(funnel.expired ?? 0),
    still_able_to_confirm: Number(funnel.still_in_window ?? 0),
    confirmation_rate: sent > 0 ? confirmed / sent : null,
    average_confirmation_time_hours: (() => {
      const weightedCount = timeValues.reduce((total, value) => total + value.count, 0);
      return weightedCount > 0
        ? timeValues.reduce((total, value) => total + value.avg * value.count, 0) / weightedCount
        : timeValues.length > 0
          ? timeValues.reduce((total, value) => total + value.avg, 0) / timeValues.length
          : null;
    })(),
  };
  return {
    application: snapshots.length === 1 ? first.application : null,
    counts_by_status: counts,
    overview,
    funnel,
    time_series: timeSeries,
    time_to_confirm_hours: {
      avg: overview.average_confirmation_time_hours,
      // Medians cannot be combined from per-scope medians without the raw
      // durations. Keep the exact value for one scope and avoid presenting an
      // invented precision for an aggregate query.
      median:
        snapshots.length === 1 && medianValues.length > 0
          ? medianValues.reduce((total, value) => total + value, 0) / medianValues.length
          : null,
    },
    shirt_sizes_confirmed: shirt,
    food_intolerances_confirmed: food,
    field_distributions: [...distributions.values()],
  };
}

/** Aggregate user-level logistics dimensions over all selected scopes. The
 * union removes duplicate users when a person belongs to two selected scopes,
 * and the raw user row never leaves this query. */
async function aggregateUserDistribution(
  applicationIds: number[],
  roleIds: number[],
  dimension: "shirt" | "food",
): Promise<Array<Record<string, unknown>>> {
  const scopeUsers = `WITH scope_users AS (
       SELECT DISTINCT r.user_id
         FROM application_responses r
         JOIN users u ON u.id = r.user_id
        WHERE cardinality($1::int[]) > 0
          AND r.application_id = ANY($1::int[]) AND r.status = 'confirmed'
          AND u.account_state = 'active' AND u.anonymized_at IS NULL AND u.is_test_account = false
       UNION
       SELECT DISTINCT ur.user_id
         FROM user_roles ur
         JOIN users u ON u.id = ur.user_id
         JOIN roles role ON role.id = ur.role_id AND role.deleted_at IS NULL
        WHERE cardinality($2::int[]) > 0
          AND ur.role_id = ANY($2::int[])
          AND u.account_state = 'active' AND u.anonymized_at IS NULL AND u.is_test_account = false
     )`;
  if (dimension === "shirt") {
    const { rows } = await pool.query(
      `${scopeUsers}
       SELECT u.shirt_size AS value, count(*)::int AS n
         FROM scope_users su JOIN users u ON u.id = su.user_id
        WHERE u.shirt_size IS NOT NULL
        GROUP BY u.shirt_size ORDER BY n DESC, value`,
      [applicationIds, roleIds],
    );
    return rows;
  }
  const { rows } = await pool.query(
    `${scopeUsers}
     SELECT fi.id AS intolerance_id, fi.label, count(*)::int AS n
       FROM scope_users su
       JOIN users u ON u.id = su.user_id
       JOIN LATERAL unnest(u.food_intolerances) AS uid(id) ON true
       JOIN food_intolerances fi ON fi.id = uid.id
      GROUP BY fi.id, fi.label ORDER BY n DESC, fi.id`,
    [applicationIds, roleIds],
  );
  return rows;
}

function dynamicPanelDefinitions(
  scopes: InternalScope[],
): (typeof STATISTICS_PANEL_CATALOG)[number][] {
  const fields = new Map<string, StatisticsConfig | undefined>();
  for (const scope of scopes) {
    for (const field of scope.application?.template ?? []) {
      if (field.reporting === true || field.statistics?.enabled === true) {
        fields.set(fieldPanelKey(field.key), field.statistics);
      }
    }
  }
  return [...fields.keys()].map((key) => ({
    key,
    dataKind: "distribution" as const,
    supportedScopeKinds: ["application"] as const,
    supportsMultipleScopes: true,
    supportsAggregation: true,
  }));
}

export async function queryStatistics(
  userId: number,
  query: StatisticsQuery,
  request?: Parameters<typeof userHasCapability>[2],
): Promise<Record<string, unknown>> {
  const requestedScopes = [...new Set(query.scopes)];
  const allScopes = await accessibleStatisticsScopes(userId, request);
  const byKey = new Map(allScopes.map((scope) => [scope.key, scope]));
  const scopes = requestedScopes.map((key) => byKey.get(key));
  if (scopes.some((scope) => !scope)) throw new ForbiddenError("Statistics scope is not available");
  const selectedScopes = scopes as InternalScope[];
  const scopeKinds = selectedScopes.map((scope) => scope.kind);
  const dynamicDefinitions = dynamicPanelDefinitions(selectedScopes);
  const definitions = [...STATISTICS_PANEL_CATALOG, ...dynamicDefinitions];
  const definitionByKey = new Map(definitions.map((definition) => [definition.key, definition]));
  const defaultPanelKeys = [...new Set(selectedScopes.flatMap((scope) => scope.panelKeys))].filter(
    (key) => isCompatibleStatisticsPanel(key, scopeKinds),
  );
  const panelKeys = (query.panelKeys?.length ? query.panelKeys : defaultPanelKeys).map(
    canonicalStatisticsPanelKey,
  );
  for (const panelKey of [...new Set(panelKeys)]) {
    const definition = definitionByKey.get(panelKey) ?? panelDefinition(panelKey);
    if (!definition || !isCompatibleStatisticsPanel(panelKey, scopeKinds)) {
      throw new ForbiddenError("Statistics panel is not available");
    }
    if (selectedScopes.length > 1 && !definition.supportsMultipleScopes) {
      throw new ForbiddenError("Statistics panel does not support multiple scopes");
    }
    let authorizedScopeCount = 0;
    for (const scope of selectedScopes) {
      if (!definition.supportedScopeKinds.includes(scope.kind)) continue;
      if (scope.panelKeys.includes(panelKey)) authorizedScopeCount += 1;
    }
    // A mixed query may contain a scope that supports the panel but has an
    // explicit deny; that scope contributes nothing. A query consisting only
    // of denied scopes is still rejected, so a panel grant can never be used
    // as a probe for an unauthorized resource.
    if (authorizedScopeCount === 0) throw new ForbiddenError("Statistics panel is not available");
  }

  const applicationScopes = selectedScopes.filter(
    (scope): scope is InternalScope & { application: ApplicationRow } =>
      scope.kind === "application" && scope.application !== undefined,
  );
  const roleScopes = selectedScopes.filter((scope) => scope.kind === "role");
  const snapshots = await Promise.all(
    applicationScopes.map((scope) =>
      applicationStats(scope.id, undefined, new Set(scope.panelKeys)),
    ),
  );
  const result = mergeApplicationSnapshots(snapshots);

  if (panelKeys.includes("shirt-sizes")) {
    const shirtApplicationIds = applicationScopes
      .filter((scope) => scope.panelKeys.includes("shirt-sizes"))
      .map((scope) => scope.id);
    const shirtRoleIds = roleScopes
      .filter((scope) => scope.panelKeys.includes("shirt-sizes"))
      .map((scope) => scope.id);
    result.shirt_sizes_confirmed = await aggregateUserDistribution(
      shirtApplicationIds,
      shirtRoleIds,
      "shirt",
    );
  }
  if (panelKeys.includes("food-intolerances")) {
    const foodApplicationIds = applicationScopes
      .filter((scope) => scope.panelKeys.includes("food-intolerances"))
      .map((scope) => scope.id);
    const foodRoleIds = roleScopes
      .filter((scope) => scope.panelKeys.includes("food-intolerances"))
      .map((scope) => scope.id);
    result.food_intolerances_confirmed = await aggregateUserDistribution(
      foodApplicationIds,
      foodRoleIds,
      "food",
    );
  }

  const allowedPanelSet = new Set(panelKeys);
  if (snapshots.length > 0) {
    // `applicationStats` was filtered per scope above; this second pass removes
    // compatible panels that the caller did not request from the merged view.
    const fields =
      (result.field_distributions as Array<{ field: { key: string } }> | undefined) ?? [];
    result.field_distributions = fields.filter((field) =>
      allowedPanelSet.has(fieldPanelKey(field.field.key)),
    );
    const timeSeries = result.time_series as Record<string, unknown> | undefined;
    if (timeSeries) {
      const seriesPanelKeys: Record<string, string> = {
        submissions_by_day: "applications-over-time",
        confirmations_by_day: "confirmations-over-time",
        submissions_by_hour_of_day: "applications-by-hour",
        submissions_by_day_of_week: "applications-by-day-of-week",
      };
      for (const [key, panel] of Object.entries(seriesPanelKeys)) {
        if (!allowedPanelSet.has(panel)) delete timeSeries[key];
      }
    }
  }
  if (!allowedPanelSet.has("overview")) {
    delete result.overview;
    delete result.funnel;
    delete result.counts_by_status;
    delete result.time_to_confirm_hours;
  }
  if (!allowedPanelSet.has("shirt-sizes")) delete result.shirt_sizes_confirmed;
  if (!allowedPanelSet.has("food-intolerances")) delete result.food_intolerances_confirmed;

  return {
    ...result,
    selected_scopes: selectedScopes.map(publicStatisticsScope),
    panel_keys: [...new Set(panelKeys)],
    panel_catalog: definitions.filter((definition) => new Set(panelKeys).has(definition.key)),
  };
}

export async function statisticsCsv(
  userId: number,
  query: StatisticsQuery,
  request?: Parameters<typeof userHasCapability>[2],
): Promise<string> {
  const result = await queryStatistics(userId, query, request);
  const scopes = (result.selected_scopes as StatisticsScope[])
    .map((scope) => scope.name)
    .join(" + ");
  const lines = ["scope,panel,category,count,percentage"];
  const add = (panel: string, category: string, count: number, percentage?: number | null) =>
    lines.push(
      [
        scopes,
        panel,
        category,
        count,
        percentage == null ? "" : `${(percentage * 100).toFixed(1)}%`,
      ]
        .map(csvCell)
        .join(","),
    );
  for (const [key, value] of Object.entries(
    (result.overview as Record<string, unknown> | undefined) ?? {},
  )) {
    if (typeof value === "number") add("overview", key, value);
  }
  for (const row of (result.shirt_sizes_confirmed as
    | Array<{ value: string; n: number }>
    | undefined) ?? [])
    add("shirt-sizes", row.value, row.n);
  for (const row of (result.food_intolerances_confirmed as
    | Array<{ label: Record<string, string>; n: number }>
    | undefined) ?? [])
    add("food-intolerances", row.label.en ?? "", row.n);
  for (const distribution of (result.field_distributions as
    | Array<{
        field: { key: string; label: Record<string, string> };
        buckets: Array<{ value: string; n: number }>;
      }>
    | undefined) ?? []) {
    const total = distribution.buckets.reduce((sum, row) => sum + row.n, 0);
    for (const row of distribution.buckets)
      add(distribution.field.key, row.value, row.n, total > 0 ? row.n / total : null);
  }
  return `${lines.join("\r\n")}\r\n`;
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
