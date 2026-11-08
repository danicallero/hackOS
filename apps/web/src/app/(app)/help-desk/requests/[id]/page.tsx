"use client";
import { useParams } from "next/navigation";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { StaleDataNotice } from "@/components/common/stale-data-notice";
import { useLocale } from "@/lib/i18n";
import type { HelpRequest } from "../../model";
import { RequestRow } from "../../request-list";
import { HelpdeskError, HelpdeskLoading, useHelpdesk } from "../../shared";
export default function RequestPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLocale();
  const resource = useHelpdesk<HelpRequest>(
    ["request", id],
    `/api/helpdesk/requests/${encodeURIComponent(id)}`,
  );
  return (
    <PageLayout width="reading">
      <PageHeader reserveNavigation={false} title={t("helpDeskRequestHelp")} />
      {resource.stale ? <StaleDataNotice onRetry={resource.refetch} /> : null}
      {resource.error ? <HelpdeskError error={resource.error} retry={resource.refetch} /> : null}
      {resource.loading ? (
        <HelpdeskLoading />
      ) : resource.data ? (
        <RequestRow request={resource.data} reload={resource.refetch} />
      ) : null}
    </PageLayout>
  );
}
