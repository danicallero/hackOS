"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { usePathname } from "next/navigation";
import { AccessDenied } from "@/components/common/access-denied";
import { PageLayout } from "@/components/common/page-layout";
import { HelpDeskSectionHeader } from "@/components/common/section-navigation";
import { StaleDataNotice } from "@/components/common/stale-data-notice";
import { TabBar } from "@/components/common/tab-bar";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { useOwnHelperProfile } from "@/hooks/use-own-helper-profile";
import { type MessageKey, useLocale } from "@/lib/i18n";
import { useSessionContext } from "@/lib/session";
import { useUrlTab } from "@/lib/url-tab";
import type { HelpRequest } from "./model";
import { RequestTable } from "./request-list";
import { HelpdeskError, HelpdeskLoading, useHelpdesk } from "./shared";

type RequestView = "mine" | "open" | "claims";
const VIEW_PATH: Record<RequestView, string> = {
  mine: "/api/helpdesk/requests/mine",
  open: "/api/helpdesk/inbox?scope=open",
  claims: "/api/helpdesk/inbox?scope=mine",
};
const VIEW_LABEL: Record<RequestView, MessageKey> = {
  mine: "helpDeskRequests",
  open: "helpDeskOpenRequests",
  claims: "helpDeskAssigned",
};

/** H64-H66: one personal workflow, also served at the published requests/inbox URLs. */
export default function HelpdeskPage() {
  const { can, canAny } = useSessionContext();
  const { t } = useLocale();
  const pathname = usePathname();
  const profile = useOwnHelperProfile();
  const allowed = canAny(
    CAPABILITIES.HELPDESK_REQUEST,
    CAPABILITIES.HELPDESK_OFFER,
    CAPABILITIES.HELPDESK_COVERAGE,
  );
  const canRequest = can(CAPABILITIES.HELPDESK_REQUEST);
  const helper = can(CAPABILITIES.HELPDESK_OFFER) && profile.data?.eligible === true;
  const views: RequestView[] = [
    ...(canRequest ? (["mine"] as const) : []),
    ...(helper ? (["open", "claims"] as const) : []),
  ];
  const defaultView = pathname === "/help-desk/inbox" && helper ? "open" : (views[0] ?? "mine");
  const { tab, setTab } = useUrlTab({
    values: views,
    defaultValue: defaultView,
    aliases: { assigned: "claims" },
  });
  const view = views.includes(tab) ? tab : views[0];
  const resource = useHelpdesk<{ requests: HelpRequest[] }>(
    ["home", view ?? "none"],
    VIEW_PATH[view ?? "mine"],
    allowed && !!view,
  );
  if (!allowed) return <AccessDenied ask={t("noAccessTitle")} />;
  const content = (
    <div className="space-y-4">
      {resource.stale ? <StaleDataNotice onRetry={resource.refetch} /> : null}
      {resource.error ? <HelpdeskError error={resource.error} retry={resource.refetch} /> : null}
      {resource.loading ? (
        <HelpdeskLoading />
      ) : resource.data && view ? (
        <RequestTable
          key={view}
          returnHref={`${pathname}?tab=${view}`}
          audience={view === "mine" ? "requester" : "helper"}
          requests={resource.data.requests}
          reload={resource.refetch}
          onClaimed={() => setTab("claims")}
        />
      ) : null}
    </div>
  );
  return (
    <PageLayout>
      <HelpDeskSectionHeader />
      {profile.error ? <HelpdeskError error={profile.error} retry={profile.reload} /> : null}
      {view && views.length === 1 ? (
        content
      ) : view ? (
        <Tabs value={view} onValueChange={setTab}>
          {views.length > 1 ? (
            <TabBar width="content" aria-label={t("helpDeskAllRequests")}>
              {views.map((value) => (
                <TabsTrigger key={value} value={value}>
                  {t(VIEW_LABEL[value])}
                </TabsTrigger>
              ))}
            </TabBar>
          ) : null}
          <TabsContent value={view}>{content}</TabsContent>
        </Tabs>
      ) : profile.loading ? (
        <HelpdeskLoading />
      ) : null}
    </PageLayout>
  );
}
