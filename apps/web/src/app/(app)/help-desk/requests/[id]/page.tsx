"use client";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useParams, useSearchParams } from "next/navigation";
import { BackLink } from "@/components/common/back-link";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { StaleDataNotice } from "@/components/common/stale-data-notice";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import type { HelpRequest } from "../../model";
import { requestListSource } from "../../navigation";
import { RequestDetail } from "../../request-list";
import { HelpdeskError, HelpdeskLoading, useHelpdesk } from "../../shared";

/** H64-H66: one request, reached from a list or a notification link. */
export default function RequestPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLocale();
  const from = useSearchParams().get("from");
  const source = requestListSource(from);
  const helper = useCan(CAPABILITIES.HELPDESK_OFFER);
  const requester = useCan(CAPABILITIES.HELPDESK_REQUEST);
  const resource = useHelpdesk<HelpRequest>(
    ["request", id],
    `/api/helpdesk/requests/${encodeURIComponent(id)}`,
  );
  const request = resource.data;
  // Back to the reader's own list: their requests, else the helper inbox.
  const mine = requester && !(helper && request?.viewer.notified);
  const returnTo =
    source ?? (mine ? "/help-desk?tab=mine" : helper ? "/help-desk?tab=claims" : "/help-desk");
  const back = <BackLink href={returnTo} label={t("helpDeskAllRequests")} />;
  return (
    <PageLayout width="reading">
      <PageHeader
        context={back}
        title={
          request
            ? (request.project?.name ??
              request.requester?.displayName ??
              t("helpDeskRemovedAccount"))
            : t("helpDeskViewRequest")
        }
      />
      {resource.stale ? <StaleDataNotice onRetry={resource.refetch} /> : null}
      {resource.error ? <HelpdeskError error={resource.error} retry={resource.refetch} /> : null}
      {resource.loading ? (
        <HelpdeskLoading />
      ) : request ? (
        <RequestDetail request={request} reload={resource.refetch} source={returnTo} />
      ) : null}
    </PageLayout>
  );
}
