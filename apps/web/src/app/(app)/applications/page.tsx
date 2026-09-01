"use client";

// Application forms directory (H11-H14): manage, review, and decision holders
// share the protected list. Only applications:manage can create a form or
// reach the builder controls on its detail page.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { ClipboardListIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { type Column, DataTable } from "@/components/common/data-table";
import { PageHeader } from "@/components/common/page-header";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { type ApplicationForm, fmtDateTime, grantedBadgeCategoryLabel, windowState } from "./lib";

export default function ApplicationsPage() {
  const { t } = useLocale();
  const canManage = useCan(CAPABILITIES.APPLICATIONS_MANAGE);
  const [forms, setForms] = useState<ApplicationForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      // The API admits manage, review, and decide holders. It never infers
      // builder permission merely from access to this directory.
      const { applications } = await api.get<{ applications: ApplicationForm[] }>(
        "/api/applications",
      );
      setForms(applications);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t("couldNotLoadApplicationForms");
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Soft, in-place refresh instead of a hard reload when another admin
  // creates/edits a form elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream?topic=applications", [
    EVENTS.DOMAIN_CHANGED,
  ]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching the applications list from the API on mount is a legitimate external-system sync
    load();
  }, [load, liveRefresh]);

  const columns: Column<ApplicationForm>[] = [
    {
      id: "name",
      header: t("colForm"),
      sortValue: (f) => f.name.toLowerCase(),
      cell: (f) => (
        <div className="space-y-0.5">
          <div className="font-medium">{f.name}</div>
          <div className="text-muted-foreground text-xs">
            {f.template.length === 1
              ? t("questionCountOne", { count: f.template.length })
              : t("questionCountOther", { count: f.template.length })}
          </div>
        </div>
      ),
    },
    {
      id: "type",
      header: t("colGrantedRole"),
      sortValue: (f) => grantedBadgeCategoryLabel(f.granted_badge_category, t),
      cell: (f) => (
        <span className="text-sm">{grantedBadgeCategoryLabel(f.granted_badge_category, t)}</span>
      ),
    },
    {
      id: "status",
      header: t("colWindow"),
      cell: (f) => {
        const w = windowState(f, t);
        return (
          <StatusBadge tone={w.tone} dot={false}>
            {w.label}
          </StatusBadge>
        );
      },
    },
    {
      id: "opens",
      header: t("colOpens"),
      sortValue: (f) => f.open_at ?? "",
      cell: (f) => <span className="text-muted-foreground text-sm">{fmtDateTime(f.open_at)}</span>,
    },
    {
      id: "closes",
      header: t("colCloses"),
      sortValue: (f) => f.close_at ?? "",
      cell: (f) => <span className="text-muted-foreground text-sm">{fmtDateTime(f.close_at)}</span>,
    },
    {
      id: "capacity",
      header: t("colQuota"),
      align: "right",
      sortValue: (f) => f.capacity ?? Number.MAX_SAFE_INTEGER,
      cell: (f) => (
        <span className="text-sm">{f.capacity != null ? f.capacity : t("unlimitedDash")}</span>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("applications")}
        actions={
          canManage ? (
            <Button asChild>
              <Link href="/applications/new">
                <PlusIcon />
                {t("newForm")}
              </Link>
            </Button>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        data={forms}
        getRowId={(f) => String(f.id)}
        stateKey="applications-list"
        loading={loading}
        error={loadError ? { message: loadError, onRetry: load } : undefined}
        getRowHref={(f) => `/applications/${f.id}`}
        getRowLabel={(f) => f.name}
        searchable={(f) => `${f.name} ${grantedBadgeCategoryLabel(f.granted_badge_category, t)}`}
        searchPlaceholder={t("searchFormsPlaceholder")}
        empty={{
          icon: ClipboardListIcon,
          title: t("noApplicationFormsYet"),
          description: canManage ? t("createFirstFormDesc") : t("formsWillAppear"),
          action: canManage ? (
            <Button asChild>
              <Link href="/applications/new">
                <PlusIcon aria-hidden="true" />
                {t("newForm")}
              </Link>
            </Button>
          ) : undefined,
        }}
      />
    </div>
  );
}
