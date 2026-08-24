"use client";

// H53 global audit log: searchable, paginated read view over audit_log,
// filterable by actor/entity/action/date. The per-user audit tab
// (users/[id]/page.tsx AuditLogSection) stays as a scoped drill-down; this
// page is the full, unscoped query surface referenced there.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { ScrollTextIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AccessDenied } from "@/components/common/access-denied";
import { type Column, DataTable } from "@/components/common/data-table";
import { DateTimeInput } from "@/components/common/datetime-input";
import { EntityCombobox } from "@/components/common/entity-combobox";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError } from "@/lib/api";
import { getActionLabel } from "@/lib/audit-labels";
import { fromDatetimeLocal } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import { type AuditRow, type AuditVocabularyEntry, notificationsApi } from "@/lib/notifications";
import { useCan } from "@/lib/session";

const LIMIT = 50;

export const auditTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function auditActorLabel(
  row: Pick<AuditRow, "actor_name" | "actor_surname" | "actor_email">,
) {
  const fullName = [row.actor_name, row.actor_surname].filter(Boolean).join(" ").trim();
  return fullName || row.actor_email || null;
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
  const { t } = useLocale();
  const canRead = useCan(CAPABILITIES.AUDIT_READ);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [debounced, setDebounced] = useState(EMPTY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const [vocabulary, setVocabulary] = useState<AuditVocabularyEntry[]>([]);

  // Load once: the full {action, entityType} vocabulary actually present in
  // audit_log, backing the Action/Entity type comboboxes below instead of
  // free-text guessing.
  useEffect(() => {
    if (!canRead) return;
    notificationsApi
      .getAuditActions()
      .then((r) => setVocabulary(r.items))
      .catch(() => setVocabulary([]));
  }, [canRead]);

  // Debounce the filter bar, and reset to page 1 on any change.
  useEffect(() => {
    const handle = setTimeout(() => {
      setDebounced(filters);
      setOffset(0);
    }, 300);
    return () => clearTimeout(handle);
  }, [filters]);

  // Soft, in-place refresh instead of a hard reload — audit entries are
  // created by every sensitive mutation in the app (H53), so this stays on
  // the audit-scoped stream.
  const liveRefresh = useAutoRefresh("/api/events/stream?topic=audit", [EVENTS.DOMAIN_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (!canRead) {
      // Setting loading state when authorization fails is a valid early-exit pattern; the effect cancels before any data fetch runs.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    notificationsApi
      .queryAudit({
        entityType: debounced.entityType.trim() || undefined,
        entityId: debounced.entityId.trim() || undefined,
        actorQuery: debounced.actorQuery.trim() || undefined,
        action: debounced.action.trim() || undefined,
        dateFrom: fromDatetimeLocal(debounced.dateFrom) ?? undefined,
        dateTo: fromDatetimeLocal(debounced.dateTo) ?? undefined,
        limit: LIMIT,
        offset,
      })
      .then((r) => {
        if (cancelled) return;
        setItems(r.items);
        setTotal(r.total);
      })
      .catch((err) => {
        if (cancelled) return;
        setItems([]);
        setTotal(0);
        const message = err instanceof ApiError ? err.message : t("couldNotLoadAuditLog");
        setLoadError(message);
        toast.error(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [canRead, debounced, offset, liveRefresh, retryNonce, t]);

  if (!canRead) {
    return <AccessDenied ask={t("auditLogAccessDeniedDesc")} />;
  }

  const hasFilters = Object.values(filters).some((v) => v.trim() !== "");

  const actionOptions = Array.from(new Set(vocabulary.map((v) => v.action)))
    .sort()
    .map((action) => ({ action, label: getActionLabel(action, t) }));
  const entityTypeOptions = Array.from(new Set(vocabulary.map((v) => v.entity_type)))
    .sort()
    .map((entityType) => ({ entityType }));

  const columns: Column<AuditRow>[] = [
    {
      id: "when",
      header: t("colWhen"),
      cell: (r) => <span className="text-sm">{auditTimeFmt.format(new Date(r.created_at))}</span>,
    },
    {
      id: "action",
      header: t("colAction"),
      cell: (r) => <Badge variant="secondary">{getActionLabel(r.action, t)}</Badge>,
    },
    {
      id: "entity",
      header: t("colEntity"),
      cell: (r) =>
        r.entity_type === "user" ? (
          <Link
            href={`/users/${r.entity_id}`}
            className="text-sm hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {t("userInline", { id: r.entity_id })}
          </Link>
        ) : (
          <span className="text-sm">
            {r.entity_type} #{r.entity_id}
          </span>
        ),
    },
    {
      id: "actor",
      header: t("colActor"),
      cell: (r) =>
        r.actor_id ? (
          <Link
            href={`/users/${r.actor_id}`}
            className="text-sm hover:underline"
            onClick={(e) => e.stopPropagation()}
            title={`#${r.actor_id}`}
          >
            {auditActorLabel(r) ?? `#${r.actor_id}`}
          </Link>
        ) : (
          <span className="text-muted-foreground text-sm">{t("systemActor")}</span>
        ),
    },
    {
      id: "source",
      header: t("colSource"),
      cell: (r) =>
        r.source ? (
          <Badge variant="outline" className="capitalize">
            {r.source}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + LIMIT, total);

  return (
    <div className="space-y-6">
      <PageHeader title={t("auditLog")} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
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
            className="h-9 w-48"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-entity-type" className="text-muted-foreground text-xs">
            {t("entityTypeLabel")}
          </Label>
          <EntityCombobox
            id="audit-entity-type"
            options={entityTypeOptions}
            value={filters.entityType}
            onChange={(v) => setFilters((f) => ({ ...f, entityType: v }))}
            getId={(o) => o.entityType}
            getLabel={(o) => o.entityType}
            placeholder={t("allEntityTypesPlaceholder")}
            className="h-9 w-48"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-entity-id" className="text-muted-foreground text-xs">
            {t("entityIdLabel")}
          </Label>
          <Input
            id="audit-entity-id"
            value={filters.entityId}
            onChange={(e) => setFilters((f) => ({ ...f, entityId: e.target.value }))}
            className="h-9 w-28"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-actor" className="text-muted-foreground text-xs">
            {t("actorUserIdLabel")}
          </Label>
          <Input
            id="audit-actor"
            value={filters.actorQuery}
            onChange={(e) => setFilters((f) => ({ ...f, actorQuery: e.target.value }))}
            placeholder={`${t("egPrefix")} Daniel, daniel@...`}
            className="h-9 w-44"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-from" className="text-muted-foreground text-xs">
            {t("fromLabel")}
          </Label>
          <DateTimeInput
            id="audit-from"
            value={filters.dateFrom}
            onChange={(v) => setFilters((f) => ({ ...f, dateFrom: v }))}
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-to" className="text-muted-foreground text-xs">
            {t("toLabel")}
          </Label>
          <DateTimeInput
            id="audit-to"
            value={filters.dateTo}
            onChange={(v) => setFilters((f) => ({ ...f, dateTo: v }))}
            className="h-9"
          />
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
            {t("clearFilters")}
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={items}
        getRowId={(r) => String(r.id)}
        loading={loading}
        error={
          loadError
            ? { message: loadError, onRetry: () => setRetryNonce((value) => value + 1) }
            : undefined
        }
        getRowHref={(r) => `/audit/${r.id}`}
        getRowLabel={(r) => `${getActionLabel(r.action, t)} ${r.entity_type} ${r.entity_id}`}
        empty={{
          icon: ScrollTextIcon,
          title: t("noAuditEntriesTitle"),
          description: hasFilters ? t("noEntriesMatchFilters") : t("sensitiveActionsAppearDesc"),
        }}
        filteredEmpty={{ active: hasFilters, onClear: () => setFilters(EMPTY_FILTERS) }}
      />

      {total > 0 && (
        <div className="flex items-center justify-between gap-2">
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
    </div>
  );
}
