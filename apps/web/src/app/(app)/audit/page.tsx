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
import { Modal } from "@/components/common/modal";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError } from "@/lib/api";
import { fromDatetimeLocal } from "@/lib/datetime";
import { useLocale } from "@/lib/i18n";
import { type AuditRow, notificationsApi } from "@/lib/notifications";
import { useCan } from "@/lib/session";

const LIMIT = 50;

const timeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

interface FilterState {
  entityType: string;
  entityId: string;
  actorId: string;
  action: string;
  dateFrom: string;
  dateTo: string;
}

const EMPTY_FILTERS: FilterState = {
  entityType: "",
  entityId: "",
  actorId: "",
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
  const [selected, setSelected] = useState<AuditRow | null>(null);

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
  // the global stream.
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (!canRead) {
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
        actorId: debounced.actorId.trim() ? Number(debounced.actorId.trim()) : undefined,
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

  const columns: Column<AuditRow>[] = [
    {
      id: "when",
      header: t("colWhen"),
      cell: (r) => <span className="text-sm">{timeFmt.format(new Date(r.created_at))}</span>,
    },
    {
      id: "action",
      header: t("colAction"),
      cell: (r) => <span className="font-mono text-xs">{r.action}</span>,
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
          >
            #{r.actor_id}
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
          <Input
            id="audit-action"
            value={filters.action}
            onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
            placeholder={`${t("egPrefix")} create, update`}
            className="h-9 w-40"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-entity-type" className="text-muted-foreground text-xs">
            {t("entityTypeLabel")}
          </Label>
          <Input
            id="audit-entity-type"
            value={filters.entityType}
            onChange={(e) => setFilters((f) => ({ ...f, entityType: e.target.value }))}
            placeholder={`${t("egPrefix")} user, announcement`}
            className="h-9 w-44"
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
          <Label htmlFor="audit-actor-id" className="text-muted-foreground text-xs">
            {t("actorUserIdLabel")}
          </Label>
          <Input
            id="audit-actor-id"
            type="number"
            value={filters.actorId}
            onChange={(e) => setFilters((f) => ({ ...f, actorId: e.target.value }))}
            className="h-9 w-28"
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
        onRowClick={setSelected}
        getRowLabel={(r) => `${r.action} ${r.entity_type} ${r.entity_id}`}
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

      {selected && (
        <Modal
          open={Boolean(selected)}
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
          title={`${selected.action} — ${selected.entity_type} #${selected.entity_id}`}
          icon={ScrollTextIcon}
          size="lg"
        >
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-muted-foreground text-xs">{t("colWhen")}</dt>
                <dd className="break-words">{timeFmt.format(new Date(selected.created_at))}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">{t("colSource")}</dt>
                <dd className="break-words">{selected.source ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">{t("colActor")}</dt>
                <dd className="break-words">
                  {selected.actor_id
                    ? t("userInline", { id: selected.actor_id })
                    : t("systemActor")}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">{t("reasonLabel")}</dt>
                <dd className="break-words">{selected.reason ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">{t("ipLabel")}</dt>
                <dd className="break-words">{selected.ip ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">{t("userAgentLabel")}</dt>
                <dd className="break-words">{selected.user_agent ?? "—"}</dd>
              </div>
            </dl>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs">{t("beforeLabel")}</p>
                <pre className="bg-muted max-h-64 overflow-auto rounded-md p-3 text-xs">
                  {selected.before === null || selected.before === undefined
                    ? "—"
                    : JSON.stringify(selected.before, null, 2)}
                </pre>
              </div>
              <div className="space-y-1">
                <p className="text-muted-foreground text-xs">{t("afterLabel")}</p>
                <pre className="bg-muted max-h-64 overflow-auto rounded-md p-3 text-xs">
                  {selected.after === null || selected.after === undefined
                    ? "—"
                    : JSON.stringify(selected.after, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
