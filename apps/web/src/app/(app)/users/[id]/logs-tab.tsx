"use client";

// Audit trail for this person (H53).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { type Column, DataTable } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { useServerResource } from "@/hooks/use-server-resource";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { formatUserDate } from "./shared";

export interface ActivityPass {
  id: number;
  activityName: string;
  category: string;
  loggedAt: string;
}
export interface UserActivity {
  passes: ActivityPass[];
}

export function LogsTab({ userId }: { userId: number }) {
  return <AuditLogSection userId={userId} />;
}

interface AuditRow {
  id: number;
  actor_id: number | null;
  entity_type: string;
  entity_id: string;
  action: string;
  source: string | null;
  created_at: string;
}

function AuditLogSection({ userId }: { userId: number }) {
  const { language, t } = useLocale();
  const canAudit = useCan(CAPABILITIES.AUDIT_READ);
  const resource = useServerResource(
    ["user", userId, "audit"],
    (signal) =>
      api.get<{ items: AuditRow[]; total: number }>("/api/audit", {
        query: { entityType: "user", entityId: String(userId), limit: 100 },
        signal,
      }),
    { enabled: canAudit },
  );
  const state =
    !canAudit || (resource.error instanceof ApiError && resource.error.status === 403)
      ? "forbidden"
      : resource.loading
        ? "loading"
        : resource.error
          ? "error"
          : "ready";
  const items = resource.data?.items ?? [];

  if (state === "forbidden") {
    return <EmptyState title={t("auditLogUnavailableTitle")} description={t("needAuditReadCap")} />;
  }
  if (state === "loading") {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-5" />
      </div>
    );
  }
  if (state === "error") {
    return <EmptyState title={t("couldNotLoadAuditLog")} />;
  }

  const columns: Column<AuditRow>[] = [
    {
      id: "action",
      header: t("colAction"),
      cell: (r) => <span className="font-mono text-xs">{r.action}</span>,
    },
    {
      id: "entity",
      header: t("colEntity"),
      cell: (r) => (
        <span className="text-muted-foreground text-sm">
          {r.entity_type} #{r.entity_id}
        </span>
      ),
    },
    {
      id: "when",
      header: t("colWhen"),
      sortValue: (r) => r.created_at,
      cell: (r) => <span className="text-sm">{formatUserDate(r.created_at, language)}</span>,
    },
    {
      id: "source",
      header: t("colSource"),
      cell: (r) =>
        r.source ? (
          <span className="text-muted-foreground capitalize text-sm">{r.source}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <SectionCard title={t("auditLog")} bodyClassName="p-0">
      <DataTable
        columns={columns}
        data={items}
        getRowId={(r) => String(r.id)}
        pageSize={15}
        empty={{
          title: t("noAuditEntriesYet"),
          description: t("auditEntriesAppearHere"),
        }}
      />
    </SectionCard>
  );
}
