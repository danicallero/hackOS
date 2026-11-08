"use client";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { useState } from "react";
import { AccessDenied } from "@/components/common/access-denied";
import { PageLayout } from "@/components/common/page-layout";
import { HelpDeskSectionHeader } from "@/components/common/section-navigation";
import { StaleDataNotice } from "@/components/common/stale-data-notice";
import { TabBar } from "@/components/common/tab-bar";
import { Tabs, TabsTrigger } from "@/components/ui/tabs";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import type { HelpRequest } from "../model";
import { RequestTable } from "../request-list";
import { HelpdeskError, HelpdeskLoading, useHelpdesk } from "../shared";

/** H65/H66: every open request (the ones routed to me first) and my claims. */
export default function InboxPage() {
  const { t } = useLocale();
  const allowed = useCan(CAPABILITIES.HELPDESK_OFFER);
  const [scope, setScope] = useState("open");
  const resource = useHelpdesk<{ requests: HelpRequest[] }>(
    ["inbox", scope],
    `/api/helpdesk/inbox?scope=${scope}`,
    allowed,
  );
  if (!allowed) return <AccessDenied ask={t("noAccessTitle")} />;
  return (
    <PageLayout>
      <HelpDeskSectionHeader />
      <Tabs value={scope} onValueChange={setScope}>
        <TabBar width="content">
          <TabsTrigger value="open">{t("helpDeskOpen")}</TabsTrigger>
          <TabsTrigger value="mine">{t("helpDeskAssigned")}</TabsTrigger>
        </TabBar>
      </Tabs>
      {resource.stale ? <StaleDataNotice onRetry={resource.refetch} /> : null}
      {resource.error ? <HelpdeskError error={resource.error} retry={resource.refetch} /> : null}
      {resource.loading ? (
        <HelpdeskLoading />
      ) : resource.data ? (
        <RequestTable
          audience="helper"
          requests={resource.data.requests}
          reload={resource.refetch}
          onClaimed={() => setScope("mine")}
        />
      ) : null}
    </PageLayout>
  );
}
