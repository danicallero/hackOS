"use client";

// Enterprise detail (H43/H44): admins with sponsors:manage edit a sponsor's
// full profile — name, links, priority, reveal window/visibility — and manage its
// logo. The logo is uploaded via a presigned PUT (H44 object storage); the API
// sets logo_url to the resulting public URL server-side, so we just reload.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/csr/EnvelopeSimple";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { BackLink } from "@/components/common/back-link";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { Spinner } from "@/components/common/spinner";
import { SponsorLogo } from "@/components/common/sponsor-logo";
import { StaleDataNotice } from "@/components/common/stale-data-notice";
import { TabBar } from "@/components/common/tab-bar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { useLiveQuery } from "@/hooks/use-live-query";
import { useIsMobile } from "@/hooks/use-mobile";
import { api, isNotFoundError } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { initials } from "@/lib/initials";
import { useCan, useSessionContext } from "@/lib/session";
import { useUrlTab } from "@/lib/url-tab";
import { ENTERPRISE_TAB_ALIASES, type Enterprise, enterpriseTabs } from "../shared";
import { ChallengesSummaryCard, EditCard, LogoCard, MembersCard } from "./enterprise-cards";
import { JudgesCard } from "./judges-card";
import { StandTagsCard } from "./stand-tags-card";

export default function EnterpriseDetailPage() {
  const { t } = useLocale();
  const isMobile = useIsMobile();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();
  const { me } = useSessionContext();
  const canManage = useCan(CAPABILITIES.SPONSORS_MANAGE);
  const tabs = enterpriseTabs({ canManage, isSponsorRep: Boolean(me?.isSponsorRep) });
  const { tab, setTab, requested } = useUrlTab({
    values: tabs,
    defaultValue: "profile",
    aliases: ENTERPRISE_TAB_ALIASES,
  });

  // Sponsor invite links moved to the shared invitations screen (#929).
  useEffect(() => {
    if (canManage && requested === "invitations") router.replace("/users/invites");
  }, [canManage, requested, router]);

  const validId = Number.isFinite(id);
  // Soft, in-place refresh when another admin edits this enterprise elsewhere.
  // A failed background refetch keeps the loaded enterprise (#1012).
  const {
    data: enterprise,
    error,
    stale,
    refetch,
  } = useLiveQuery(
    (signal) => api.get<Enterprise>(`/api/enterprises/${id}`, { signal }),
    domainScope(SSE_TOPICS.SPONSORS),
    [EVENTS.DOMAIN_CHANGED],
    { enabled: validId, resourceKey: ["enterprise", id] },
  );
  const shownError = error && (enterprise === null || isNotFoundError(error)) ? error : null;
  const notFound = !validId || isNotFoundError(shownError);
  const errorMsg = shownError ? apiErrorText(shownError, t, t("couldNotLoadEnterprise")) : "";

  if (validId && !shownError && !enterprise) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (!validId || shownError || !enterprise) {
    if (!notFound) {
      return (
        <ContextualError
          message={errorMsg || t("couldNotLoadEnterprise")}
          onRetry={() => refetch()}
        />
      );
    }
    return (
      <div className="space-y-6">
        <BackLink href="/enterprises" label={t("enterprises")} />
        <EmptyState
          title={t("enterpriseNotFoundTitle")}
          description={errorMsg || t("enterpriseNotLoadedDesc")}
        />
      </div>
    );
  }

  return (
    <PageLayout>
      {stale && <StaleDataNotice onRetry={() => refetch()} />}
      <PageHeader
        context={<BackLink href="/enterprises" label={t("enterprises")} />}
        leading={
          <Avatar size="lg">
            {enterprise.logo_url ? (
              <SponsorLogo
                logoUrl={enterprise.logo_url}
                logoNegativeUrl={enterprise.logo_negative_url}
                alt={enterprise.name}
                className="size-full object-contain"
              />
            ) : (
              <AvatarFallback>{initials(enterprise.name)}</AvatarFallback>
            )}
          </Avatar>
        }
        title={enterprise.name}
        className="flex-row items-center justify-between gap-2 md:items-center"
        actions={
          canManage && (
            <Button
              asChild
              variant="outline"
              size={isMobile ? "icon" : "default"}
              aria-label={isMobile ? t("invitationManagement") : undefined}
            >
              <Link href="/users/invites">
                {isMobile ? <EnvelopeSimpleIcon aria-hidden="true" /> : t("invitationManagement")}
              </Link>
            </Button>
          )
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabBar aria-label={t("enterpriseSections")}>
          <TabsTrigger value="profile">{t("profileTitle")}</TabsTrigger>
          {tabs.includes("challenges") && (
            <TabsTrigger value="challenges">{t("challenges")}</TabsTrigger>
          )}
          <TabsTrigger value="judges">{t("judges")}</TabsTrigger>
          {canManage && <TabsTrigger value="members">{t("membersTitle")}</TabsTrigger>}
          {tabs.includes("stand") && <TabsTrigger value="stand">{t("standTags")}</TabsTrigger>}
        </TabBar>
        <TabsContent value="profile" className="space-y-6 pt-2">
          <EditCard
            enterprise={enterprise}
            canManage={canManage}
            onSaved={() => refetch()}
            logoUploader={<LogoCard enterprise={enterprise} onChanged={() => refetch()} />}
          />
        </TabsContent>
        {tabs.includes("challenges") && (
          <TabsContent value="challenges" className="pt-2">
            <ChallengesSummaryCard enterprise={enterprise} canManage={canManage} />
          </TabsContent>
        )}
        <TabsContent value="judges" className="pt-2">
          <JudgesCard enterpriseId={enterprise.id} />
        </TabsContent>
        {canManage && (
          <TabsContent value="members" className="pt-2">
            <MembersCard enterpriseId={enterprise.id} />
          </TabsContent>
        )}
        {tabs.includes("stand") && (
          <TabsContent value="stand" className="pt-2">
            <StandTagsCard
              enterpriseId={enterprise.id}
              enterpriseName={enterprise.name}
              scannable={enterprise.stand_scannable}
              canManage={canManage}
              onScannableChange={() => refetch()}
            />
          </TabsContent>
        )}
      </Tabs>
    </PageLayout>
  );
}
