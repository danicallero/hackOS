"use client";

// Audit trail for this person (H53).

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { FileTextIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { type Column, DataTable } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { Badge } from "@/components/ui/badge";
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

export function AuditLogSection({ userId }: { userId: number }) {
  const { language, t } = useLocale();
  const canAudit = useCan(CAPABILITIES.AUDIT_READ);
  const [items, setItems] = useState<AuditRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "error">("loading");

  useEffect(() => {
    if (!canAudit) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState("forbidden");
      return;
    }
    let cancelled = false;
    setState("loading");
    // Audit entries about this user's record (entity_type=user, entity_id=:id).
    api
      .get<{ items: AuditRow[]; total: number }>("/api/audit", {
        query: { entityType: "user", entityId: String(userId), limit: 100 },
      })
      .then((r) => {
        if (cancelled) return;
        setItems(r.items);
        setState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setState(err instanceof ApiError && err.status === 403 ? "forbidden" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [userId, canAudit]);

  if (state === "forbidden") {
    return (
      <EmptyState
        icon={FileTextIcon}
        title={t("auditLogUnavailableTitle")}
        description={t("needAuditReadCap")}
      />
    );
  }
  if (state === "loading") {
    return (
      <div className="flex justify-center py-12">
        <Spinner className="size-5" />
      </div>
    );
  }
  if (state === "error") {
    return <EmptyState icon={FileTextIcon} title={t("couldNotLoadAuditLog")} />;
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
          <Badge variant="outline" className="capitalize">
            {r.source}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <SectionCard icon={FileTextIcon} title={t("auditLog")} bodyClassName="p-0">
      <DataTable
        columns={columns}
        data={items}
        getRowId={(r) => String(r.id)}
        pageSize={15}
        empty={{
          icon: FileTextIcon,
          title: t("noAuditEntriesYet"),
          description: t("auditEntriesAppearHere"),
        }}
      />
    </SectionCard>
  );
}
