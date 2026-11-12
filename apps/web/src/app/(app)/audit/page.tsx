"use client";

// H53 global audit log: searchable, paginated read view over audit_log,
// filterable by actor/entity/action/date. The per-user audit tab
// (users/[id]/page.tsx AuditLogSection) stays as a scoped drill-down; this
// page is the full, unscoped query surface referenced there.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { type Column, DataTable } from "@/components/common/data-table";
import { DateTimeInput } from "@/components/common/datetime-input";
import { EntityCombobox } from "@/components/common/entity-combobox";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const entityLabel = entityRef(row.entity_type, row.entity_id, t);
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

interface FilterState {
  entityType: string;
  entityId: string;
  actorQuery: string;
  action: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: FilterState = {
  entityType: "",
  entityId: "",
  actorQuery: "",
  action: "",
  dateFrom: "",
  dateTo: "",
};

export default function AuditPage() {
  const { t, language } = useLocale();
  const requestId = useSearchParams().get("request");
  const canRead = useCan(CAPABILITIES.AUDIT_READ);
  const [filters, setFilters] = usePersistedState("audit-list:filters", EMPTY_FILTERS);
  const debounced = useDebouncedValue(filters, FILTER_DEBOUNCE_MS);
  const [trackedRequest, setTrackedRequest] = useState<string | null>(null);
  const [offset, setOffset] = usePersistedState("audit-list:offset", 0);

  if (requestId !== trackedRequest) {
    setTrackedRequest(requestId);
    setOffset(0);
  }

  // Back to page 1 when the debounced filters change, but not on mount, where
  // `filters` may be a restored value and `offset` was restored alongside it.
  const [offsetFilters, setOffsetFilters] = useState(debounced);
  if (offsetFilters !== debounced) {
    setOffsetFilters(debounced);
    setOffset(0);
  }

  // The {action, entityType} vocabulary actually present in audit_log backs the
  // comboboxes; without it they still accept typed values, so a failed read
  // only leaves the suggestion lists empty.
  const { data: vocabularyData } = useServerResource(
    ["audit", "vocabulary"],
    () => notificationsApi.getAuditActions(),
    { enabled: canRead },
  );
  const vocabulary: AuditVocabularyEntry[] = vocabularyData?.items ?? [];

  // Audit entries come from every sensitive mutation (H53), so this stays on
  // the audit-scoped stream.
  const query = {
    requestId: requestId ?? undefined,
    entityType: requestId ? undefined : debounced.entityType.trim() || undefined,
    entityId: requestId ? undefined : debounced.entityId.trim() || undefined,
    actorQuery: requestId ? undefined : debounced.actorQuery.trim() || undefined,
    action: requestId ? undefined : debounced.action.trim() || undefined,
    dateFrom: requestId ? undefined : (fromDatetimeLocal(debounced.dateFrom) ?? undefined),
    dateTo: requestId ? undefined : (fromDatetimeLocal(debounced.dateTo) ?? undefined),
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

  const hasFilters = Object.values(filters).some((v) => v.trim() !== "");

  const actionOptions = Array.from(new Set(vocabulary.map((v) => v.action)))
    .map((action) => ({ action, label: getActionLabel(action, t) }))
    .sort((a, b) => a.label.localeCompare(b.label, language));
  const entityTypeOptions = Array.from(new Set(vocabulary.map((v) => v.entity_type)))
    .sort((a, b) => a.localeCompare(b, language))
    .map((entityType) => ({ entityType, label: getAuditEntityLabel(entityType, t) }));

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
            {entityRef(r.entity_type, r.entity_id, t)}
          </Link>
        ) : (
          <span className="text-sm">{entityRef(r.entity_type, r.entity_id, t)}</span>
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
        <div className="grid min-w-0 gap-3 sm:flex sm:flex-wrap sm:items-end">
          <div className="min-w-0 space-y-1">
            <Label htmlFor="audit-action" className="text-muted-foreground text-xs">
              {t("colAction")}
            </Label>
            <EntityCombobox
              id="audit-action"
              options={actionOptions}
              value={filters.action}
              onChange={(v) => setFilters((f) => ({ ...f, action: v }))}
              getId={(o) => o.action}
              getLabel={(o) => o.label}
              placeholder={t("allActionsPlaceholder")}
              className="w-full sm:w-48"
            />
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="audit-entity-type" className="text-muted-foreground text-xs">
              {t("entityTypeLabel")}
            </Label>
            <EntityCombobox
              id="audit-entity-type"
              options={entityTypeOptions}
              value={filters.entityType}
              onChange={(v) => setFilters((f) => ({ ...f, entityType: v }))}
              getId={(o) => o.entityType}
              getLabel={(o) => o.label}
              placeholder={t("allEntityTypesPlaceholder")}
              className="w-full sm:w-48"
            />
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="audit-entity-id" className="text-muted-foreground text-xs">
              {t("entityIdLabel")}
            </Label>
            <Input
              id="audit-entity-id"
              value={filters.entityId}
              onChange={(e) => setFilters((f) => ({ ...f, entityId: e.target.value }))}
              className="w-full sm:w-28"
            />
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="audit-actor" className="text-muted-foreground text-xs">
              {t("actorUserIdLabel")}
            </Label>
            <Input
              id="audit-actor"
              value={filters.actorQuery}
              onChange={(e) => setFilters((f) => ({ ...f, actorQuery: e.target.value }))}
              placeholder={`${t("egPrefix")} Daniel, daniel@...`}
              className="w-full sm:w-44"
            />
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="audit-from" className="text-muted-foreground text-xs">
              {t("fromLabel")}
            </Label>
            <DateTimeInput
              id="audit-from"
              value={filters.dateFrom}
              onChange={(v) => setFilters((f) => ({ ...f, dateFrom: v }))}
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
              onChange={(v) => setFilters((f) => ({ ...f, dateTo: v }))}
              className="w-full sm:w-auto"
            />
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
              {t("clearFilters")}
            </Button>
          )}
        </div>
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
        getRowLabel={(r) =>
          `${getActionLabel(r.action, t)} ${entityRef(r.entity_type, r.entity_id, t)}`
        }
        renderMobileRow={(r) => <AuditMobileRow row={r} />}
        empty={{
          title: t("noAuditEntriesTitle"),
          description: hasFilters ? t("noEntriesMatchFilters") : t("sensitiveActionsAppearDesc"),
        }}
        filteredEmpty={{ active: hasFilters, onClear: () => setFilters(EMPTY_FILTERS) }}
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
