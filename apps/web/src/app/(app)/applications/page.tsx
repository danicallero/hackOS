"use client";

// Application forms directory (H11-H14): manage, review, and decision holders
// share the protected list. Only applications:manage can create a form or
// reach the builder controls on its detail page.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { ClipboardTextIcon } from "@phosphor-icons/react/dist/csr/ClipboardText";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApplicationExportPanel } from "@/components/applications/application-export-panel";
import { type Column, DataTable } from "@/components/common/data-table";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { StaleDataNotice } from "@/components/common/stale-data-notice";
import { StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { useBackgroundRefresh } from "@/hooks/use-background-refresh";
import { useIsMobile } from "@/hooks/use-mobile";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { type ApplicationForm, fmtDateTime, grantedRoleNameLabel, windowState } from "./lib";

export default function ApplicationsPage() {
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const canManage = useCan(CAPABILITIES.APPLICATIONS_MANAGE);
  const canExport = useCan(CAPABILITIES.EXPORTS_RUN);
  const [forms, setForms] = useState<ApplicationForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { succeeded, failed, hasLoaded, stale, retryNonce } = useBackgroundRefresh();

  const load = useCallback(async () => {
    if (!hasLoaded()) setLoading(true);
    try {
      // The API admits manage, review, and decide holders. It never infers
      // builder permission merely from access to this directory.
      const { applications } = await api.get<{ applications: ApplicationForm[] }>(
        "/api/applications",
      );
      setForms(applications);
      succeeded();
      setLoadError(null);
    } catch (err) {
      // A failed background refresh keeps the list (#1012).
      if (!failed(err)) return;
      setLoadError(err instanceof ApiError ? err.message : t("couldNotLoadApplicationForms"));
    } finally {
      setLoading(false);
    }
  }, [t, succeeded, failed, hasLoaded]);

  // Soft, in-place refresh instead of a hard reload when another admin
  // creates/edits a form elsewhere.
  const liveRefresh = useAutoRefresh(domainScope(SSE_TOPICS.APPLICATIONS), [EVENTS.DOMAIN_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching the applications list from the API on mount is a legitimate external-system sync
    load();
  }, [load, liveRefresh, retryNonce]);

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
      sortValue: (f) => grantedRoleNameLabel(f.granted_role_name, t),
      cell: (f) => <span className="text-sm">{grantedRoleNameLabel(f.granted_role_name, t)}</span>,
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
    <PageLayout>
      {stale && <StaleDataNotice onRetry={() => void load()} />}
      <PageHeader
        title={t("applications")}
        secondaryActions={
          canExport ? (
            <ApplicationExportPanel
              trigger={
                <Button
                  variant="outline"
                  size={isMobile ? "icon" : "default"}
                  aria-label={t("exportApplicationData")}
                >
                  <DownloadSimpleIcon aria-hidden="true" />
                  {!isMobile && t("exportApplicationData")}
                </Button>
              }
            />
          ) : undefined
        }
        primaryAction={
          canManage ? (
            <Button asChild size={isMobile ? "icon" : "default"} aria-label={t("newForm")}>
              <Link href="/applications/new">
                <PlusIcon aria-hidden="true" />
                {!isMobile && t("newForm")}
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
        loading={loading && !hasLoaded()}
        error={loadError ? { message: loadError, onRetry: load } : undefined}
        getRowHref={(f) => `/applications/${f.id}`}
        getRowLabel={(f) => f.name}
        searchable={(f) => `${f.name} ${grantedRoleNameLabel(f.granted_role_name, t)}`}
        searchPlaceholder={t("searchFormsPlaceholder")}
        empty={{
          icon: ClipboardTextIcon,
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
    </PageLayout>
  );
}
