"use client";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { AccessDenied } from "@/components/common/access-denied";
import { PageLayout } from "@/components/common/page-layout";
import { HelpDeskSectionHeader } from "@/components/common/section-navigation";
import { StaleDataNotice } from "@/components/common/stale-data-notice";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import type { HelpRequest } from "../model";
import { RequestTable } from "../request-list";
import { HelpdeskError, HelpdeskLoading, useHelpdesk } from "../shared";
export default function RequestsPage() {
  const { t } = useLocale();
  const allowed = useCan(CAPABILITIES.HELPDESK_REQUEST);
  const resource = useHelpdesk<{ requests: HelpRequest[] }>(
    ["requests", "mine"],
    "/api/helpdesk/requests/mine",
    allowed,
  );
  if (!allowed) return <AccessDenied ask={t("noAccessTitle")} />;
  return (
    <PageLayout>
      <HelpDeskSectionHeader />
      {resource.stale ? <StaleDataNotice onRetry={resource.refetch} /> : null}
      {resource.error ? <HelpdeskError error={resource.error} retry={resource.refetch} /> : null}
      {resource.loading ? (
        <HelpdeskLoading />
      ) : resource.data ? (
        <RequestTable
          audience="requester"
          requests={resource.data.requests}
          reload={resource.refetch}
        />
      ) : null}
    </PageLayout>
  );
}
