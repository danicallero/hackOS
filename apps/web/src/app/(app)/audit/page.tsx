"use client";

// H53 global audit log: searchable, paginated read view over audit_log,
// filterable by actor search plus one Filters menu (action, entity type,
// entity, period) whose chips each remove a single filter. The per-user audit tab
// (users/[id]/page.tsx AuditLogSection) stays as a scoped drill-down; this
// page is the full, unscoped query surface referenced there.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { CalendarBlankIcon } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { CubeIcon } from "@phosphor-icons/react/dist/csr/Cube";
import { FingerprintIcon } from "@phosphor-icons/react/dist/csr/Fingerprint";
import { LightningIcon } from "@phosphor-icons/react/dist/csr/Lightning";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { type Column, DataTable } from "@/components/common/data-table";
import { DateTimeInput } from "@/components/common/datetime-input";
import type { FilterDefinition } from "@/components/common/filter-menu";
import { ListToolbar } from "@/components/common/list-toolbar";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useLiveQuery } from "@/hooks/use-live-query";
import { usePersistedState } from "@/hooks/use-persisted-state";
import { useServerResource } from "@/hooks/use-server-resource";
import { apiErrorText } from "@/lib/api-error-text";
import { auditChangedFields } from "@/lib/audit-diff";
import {
  entityRef,
  getActionLabel,
  getAuditActorLabel,
  getAuditEntityHref,
  getAuditEntityLabel,
  getAuditFieldLabel,
  getAuditSourceLabel,
} from "@/lib/audit-labels";
import { formatEventDate, fromDatetimeLocal } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import { type AuditRow, type AuditVocabularyEntry, notificationsApi } from "@/lib/notifications";
import { useCan } from "@/lib/session";

const LIMIT = 50;
const FILTER_DEBOUNCE_MS = 300;

function AuditMobileRow({ row }: { row: AuditRow }) {
  const { t, language } = useLocale();
  const entityLabel = entityRef(row, t);
  const actorLabel = getAuditActorLabel(row, t);
  return (
    <Link
      href={`/audit/${row.id}`}
      className="focus-visible:ring-ring block px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <time
            className="text-muted-foreground block text-xs tabular-nums"
            dateTime={row.created_at}
          >
            {formatEventDate(row.created_at, language, "dateTime")}
          </time>
          <span className="text-sm font-medium">{getActionLabel(row.action, t)}</span>
        </div>
        <CaretRightIcon className="text-muted-foreground mt-1 size-4 shrink-0" aria-hidden="true" />
      </div>
      <dl className="mt-2 flex min-w-0 flex-wrap items-start gap-x-4 gap-y-1.5 text-xs">
        <div className="flex max-w-full items-baseline gap-1 wrap-anywhere">
          <dt className="text-muted-foreground shrink-0">{t("colEntity")}:</dt>
          <dd className="min-w-0">{entityLabel}</dd>
        </div>
        <div className="flex max-w-full items-baseline gap-1 wrap-anywhere">
          <dt className="text-muted-foreground shrink-0">{t("colActor")}:</dt>
          <dd className="min-w-0">
            {actorLabel}
            {row.initiated_by && (
              <span className="text-muted-foreground">
                {" "}
                ({t("auditInitiatedBy")}: {row.initiator_name || `#${row.initiated_by}`})
              </span>
            )}
          </dd>
        </div>
        <div className="flex max-w-full items-baseline gap-1 wrap-anywhere">
          <dt className="text-muted-foreground shrink-0">{t("colSource")}:</dt>
          <dd className="min-w-0">
            {row.source ? (
              <span className="capitalize">{getAuditSourceLabel(row.source, t)}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </dd>
        </div>
      </dl>
    </Link>
  );
}

type Period = "" | "1h" | "24h" | "7d" | "30d" | "custom";

const PERIOD_MS: Record<Exclude<Period, "" | "custom">, number> = {
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

interface FilterState {
  actorQuery: string;
  action: string;
  entityType: string;
  entityId: string;
  period: Period;
  /** Fixed when a preset is picked, so the query key stays stable between renders. */
  periodStart: string;
  /** datetime-local wall-clock values for the custom period. */
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: FilterState = {
  actorQuery: "",
  action: "",
  entityType: "",
  entityId: "",
  period: "",
  periodStart: "",
  dateFrom: "",
  dateTo: "",
};

function hasActiveFilters(filters: FilterState) {
  return Boolean(
    filters.actorQuery.trim() ||
      filters.action ||
      filters.entityType ||
      filters.entityId ||
      filters.period,
  );
}

export default function AuditPage() {
  const { t, language } = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestId = searchParams.get("request");
  const canRead = useCan(CAPABILITIES.AUDIT_READ);
  // H53: every filter is one chip with its own remove action; the persisted
  // copy only keeps them across visits to an entry and back.
  const [filters, setFilters] = usePersistedState("audit-list:filters:v2", EMPTY_FILTERS);
  const debounced = useDebouncedValue(filters, FILTER_DEBOUNCE_MS);
  const [trackedRequest, setTrackedRequest] = useState<string | null>(null);
  const [offset, setOffset] = usePersistedState("audit-list:offset", 0);

  if (requestId !== trackedRequest) {
    setTrackedRequest(requestId);
    setOffset(0);
  }

  // An entity-history link (/audit?entityType=…&entityId=…) seeds the filters
  // once and leaves a clean URL, so removing the chip never fights the link.
  const linkedEntityType = searchParams.get("entityType");
  const linkedEntityId = searchParams.get("entityId");
  useEffect(() => {
    if (!linkedEntityType && !linkedEntityId) return;
    setFilters({
      ...EMPTY_FILTERS,
      entityType: linkedEntityType ?? "",
      entityId: linkedEntityId ?? "",
    });
    router.replace("/audit", { scroll: false });
  }, [linkedEntityType, linkedEntityId, router, setFilters]);

  // Back to page 1 when the debounced filters change, but not on mount, where
  // `filters` may be a restored value and `offset` was restored alongside it.
  const [offsetFilters, setOffsetFilters] = useState(debounced);
  if (offsetFilters !== debounced) {
    setOffsetFilters(debounced);
    setOffset(0);
  }

  // The {action, entityType} vocabulary actually present in audit_log backs
  // the filter menu; a failed read only leaves those two filters empty.
  const { data: vocabularyData } = useServerResource(
    ["audit", "vocabulary"],
    () => notificationsApi.getAuditActions(),
    { enabled: canRead },
  );
  const vocabulary: AuditVocabularyEntry[] = vocabularyData?.items ?? [];

  const dateFrom =
    debounced.period === "custom"
      ? fromDatetimeLocal(debounced.dateFrom)
      : debounced.period
        ? debounced.periodStart
        : null;
  const dateTo = debounced.period === "custom" ? fromDatetimeLocal(debounced.dateTo) : null;

  // Audit entries come from every sensitive mutation (H53), so this stays on
  // the audit-scoped stream.
  const query = {
    requestId: requestId ?? undefined,
    entityType: requestId ? undefined : debounced.entityType || undefined,
    entityId: requestId ? undefined : debounced.entityId || undefined,
    actorQuery: requestId ? undefined : debounced.actorQuery.trim() || undefined,
    action: requestId ? undefined : debounced.action || undefined,
    dateFrom: requestId ? undefined : (dateFrom ?? undefined),
    dateTo: requestId ? undefined : (dateTo ?? undefined),
    limit: LIMIT,
    offset,
  };
  const {
    data: page,
    error,
    loading,
    refetch,
  } = useLiveQuery(
    () => notificationsApi.queryAudit(query),
    domainScope(SSE_TOPICS.AUDIT),
    [EVENTS.DOMAIN_CHANGED],
    { enabled: canRead, resourceKey: ["audit", "query", query] },
  );
  const items = page?.items ?? [];
  const total = page?.total ?? 0;

  if (!canRead) {
    return <AccessDenied ask={t("auditLogAccessDeniedDesc")} />;
  }

  const hasFilters = hasActiveFilters(filters);
  const clearFilters = () => setFilters(EMPTY_FILTERS);

  const actionOptions = Array.from(new Set(vocabulary.map((v) => v.action)))
    .map((action) => ({ value: action, label: getActionLabel(action, t) }))
    .sort((a, b) => a.label.localeCompare(b.label, language));
  const entityTypeOptions = Array.from(new Set(vocabulary.map((v) => v.entity_type)))
    .map((entityType) => ({ value: entityType, label: getAuditEntityLabel(entityType, t) }))
    .sort((a, b) => a.label.localeCompare(b.label, language));

  const filterDefinitions: FilterDefinition[] = [
    {
      id: "action",
      label: t("colAction"),
      icon: LightningIcon,
      type: "single",
      value: filters.action,
      resetValue: "",
      onChange: (action) => setFilters((f) => ({ ...f, action })),
      options: actionOptions,
    },
    {
      id: "entityType",
      label: t("entityTypeLabel"),
      icon: CubeIcon,
      type: "single",
      value: filters.entityType,
      resetValue: "",
      // A specific entity only makes sense within its own type.
      onChange: (entityType) => setFilters((f) => ({ ...f, entityType, entityId: "" })),
      options: entityTypeOptions,
    },
    ...(filters.entityId
      ? [
          {
            id: "entityId",
            label: t("colEntity"),
            icon: FingerprintIcon,
            type: "single" as const,
            value: filters.entityId,
            resetValue: "",
            onChange: (entityId: string) => setFilters((f) => ({ ...f, entityId })),
            options: [
              {
                value: filters.entityId,
                label:
                  items.find((r) => r.entity_id === filters.entityId && r.entity_label)
                    ?.entity_label ?? `#${filters.entityId}`,
              },
            ],
          },
        ]
      : []),
    {
      id: "period",
      label: t("auditPeriodLabel"),
      icon: CalendarBlankIcon,
      type: "single",
      value: filters.period,
      resetValue: "",
      onChange: (value) => {
        const period = value as Period;
        setFilters((f) => ({
          ...f,
          period,
          periodStart:
            period && period !== "custom"
              ? new Date(Date.now() - PERIOD_MS[period]).toISOString()
              : "",
          dateFrom: period === "custom" ? f.dateFrom : "",
          dateTo: period === "custom" ? f.dateTo : "",
        }));
      },
      options: [
        { value: "1h", label: t("auditPeriodLastHour") },
        { value: "24h", label: t("auditPeriodLast24Hours") },
        { value: "7d", label: t("auditPeriodLast7Days") },
        { value: "30d", label: t("auditPeriodLast30Days") },
        { value: "custom", label: t("custom") },
      ],
    },
  ];

  const columns: Column<AuditRow>[] = [
    {
      id: "when",
      width: "w-[15%]",
      className: "whitespace-normal wrap-anywhere",
      header: t("colWhen"),
      cell: (r) => (
        <span className="text-sm">{formatEventDate(r.created_at, language, "dateTime")}</span>
      ),
    },
    {
      id: "action",
      className: "whitespace-normal wrap-anywhere",
      header: t("colAction"),
      cell: (r) => {
        const fields = [...new Set([...(r.changed_fields ?? []), ...auditChangedFields(r.after)])]
          .map((field) => getAuditFieldLabel(field, t))
          .join(", ");
        return (
          <div className="min-w-0 space-y-1">
            <span className="text-sm font-medium">{getActionLabel(r.action, t)}</span>
            {fields && (
              <p className="text-muted-foreground truncate text-xs" title={fields}>
                {fields}
              </p>
            )}
          </div>
        );
      },
    },
    {
      id: "entity",
      width: "w-[20%]",
      className: "whitespace-normal wrap-anywhere",
      header: t("colEntity"),
      cell: (r) => {
        const href = getAuditEntityHref(r.entity_type, r.entity_id);
        return href ? (
          <Link
            href={href}
            className="text-sm hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {entityRef(r, t)}
          </Link>
        ) : (
          <span className="text-sm">{entityRef(r, t)}</span>
        );
      },
    },
    {
      id: "actor",
      width: "w-[20%]",
      className: "whitespace-normal wrap-anywhere",
      header: t("colActor"),
      cell: (r) => (
        <div className="space-y-1">
          {r.actor_id ? (
            <Link
              href={`/users/${r.actor_id}`}
              className="text-sm hover:underline"
              onClick={(e) => e.stopPropagation()}
              title={`#${r.actor_id}`}
            >
              {getAuditActorLabel(r, t)}
            </Link>
          ) : (
            <span className="text-muted-foreground text-sm">{getAuditActorLabel(r, t)}</span>
          )}
          {r.initiated_by && (
            <p className="text-muted-foreground text-xs">
              {t("auditInitiatedBy")}: {r.initiator_name || `#${r.initiated_by}`}
            </p>
          )}
        </div>
      ),
    },
    {
      id: "source",
      width: "w-28",
      className: "whitespace-normal wrap-anywhere",
      header: t("colSource"),
      cell: (r) =>
        r.source ? (
          <span className="capitalize">{getAuditSourceLabel(r.source, t)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + LIMIT, total);

  return (
    <PageLayout>
      <PageHeader title={t("auditLog")} />

      {requestId ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">{t("auditRelatedActions")}</p>
          <Link href="/audit" className="text-sm hover:underline">
            {t("auditAllActions")}
          </Link>
        </div>
      ) : (
        <ListToolbar
          search={{
            id: "audit-actor",
            label: t("auditSearchActor"),
            placeholder: t("auditSearchActor"),
            value: filters.actorQuery,
            onValueChange: (actorQuery) => setFilters((f) => ({ ...f, actorQuery })),
          }}
          filters={filterDefinitions}
          feedback={
            filters.period === "custom" && (
              <div className="grid min-w-0 gap-3 sm:flex sm:flex-wrap sm:items-end">
                <div className="min-w-0 space-y-1">
                  <Label htmlFor="audit-from" className="text-muted-foreground text-xs">
                    {t("fromLabel")}
                  </Label>
                  <DateTimeInput
                    id="audit-from"
                    value={filters.dateFrom}
                    onChange={(dateFrom) => setFilters((f) => ({ ...f, dateFrom }))}
                    className="w-full sm:w-auto"
                  />
                </div>
                <div className="min-w-0 space-y-1">
                  <Label htmlFor="audit-to" className="text-muted-foreground text-xs">
                    {t("toLabel")}
                  </Label>
                  <DateTimeInput
                    id="audit-to"
                    value={filters.dateTo}
                    onChange={(dateTo) => setFilters((f) => ({ ...f, dateTo }))}
                    className="w-full sm:w-auto"
                  />
                </div>
              </div>
            )
          }
        />
      )}

      <DataTable
        columns={columns}
        data={items}
        getRowId={(r) => String(r.id)}
        stateKey="audit-list"
        loading={loading && page === null}
        error={
          error
            ? { message: apiErrorText(error, t, t("couldNotLoadAuditLog")), onRetry: refetch }
            : undefined
        }
        getRowHref={(r) => `/audit/${r.id}`}
        getRowLabel={(r) => `${getActionLabel(r.action, t)} ${entityRef(r, t)}`}
        renderMobileRow={(r) => <AuditMobileRow row={r} />}
        empty={{
          title: t("noAuditEntriesTitle"),
          description: hasFilters ? t("noEntriesMatchFilters") : t("sensitiveActionsAppearDesc"),
        }}
        filteredEmpty={{ active: hasFilters, onClear: clearFilters }}
      />

      {total > 0 && (
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-muted-foreground text-xs">
            {t("rangeOfTotal", { start: rangeStart, end: rangeEnd, total })}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}
            >
              {t("previous")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={rangeEnd >= total}
              onClick={() => setOffset((o) => o + LIMIT)}
            >
              {t("next")}
            </Button>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
