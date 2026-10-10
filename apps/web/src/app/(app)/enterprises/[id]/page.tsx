"use client";

// Enterprise detail (H43/H44): admins with sponsors:manage edit a sponsor's
// full profile — name, links, priority, reveal window/visibility — and manage its
// logo. The logo is uploaded via a presigned PUT (H44 object storage); the API
// sets logo_url to the resulting public URL server-side, so we just reload.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { BuildingsIcon } from "@phosphor-icons/react/dist/csr/Buildings";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/csr/EnvelopeSimple";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { PageLayout } from "@/components/common/page-layout";
import { Spinner } from "@/components/common/spinner";
import { SponsorLogo } from "@/components/common/sponsor-logo";
import { TabBar } from "@/components/common/tab-bar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { useIsMobile } from "@/hooks/use-mobile";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useCan, useSessionContext } from "@/lib/session";
import { useUrlTab } from "@/lib/url-tab";
import { ENTERPRISE_TAB_ALIASES, type Enterprise, enterpriseTabs, initials } from "../shared";

import { ChallengesSummaryCard, EditCard, LogoCard, MembersCard } from "./enterprise-cards";
import { JudgesCard } from "./judges-card";

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

  const [enterprise, setEnterprise] = useState<Enterprise | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async () => {
    // A background live-refresh shouldn't flash the whole page away — only
    // the very first load (before there's anything to show) should.
    setStatus((s) => (s === "ready" ? s : "loading"));
    try {
      const data = await api.get<Enterprise>(`/api/enterprises/${id}`);
      setEnterprise(data);
      setStatus("ready");
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : "Could not load this enterprise.");
      setStatus("error");
    }
  }, [id]);

  // Soft, in-place refresh instead of a hard reload when another admin edits
  // this enterprise elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream?topic=sponsors", [EVENTS.DOMAIN_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (Number.isFinite(id)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void load();
    } else setStatus("error");
  }, [id, load, liveRefresh]);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (status === "error" || !enterprise) {
    return (
      <div className="space-y-6">
        <EmptyState
          icon={BuildingsIcon}
          title={t("enterpriseNotFoundTitle")}
          description={errorMsg || t("enterpriseNotLoadedDesc")}
        />
      </div>
    );
  }

  return (
    <PageLayout>
      <PageHeader
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
        </TabBar>
        <TabsContent value="profile" className="space-y-6 pt-2">
          <EditCard
            enterprise={enterprise}
            canManage={canManage}
            onSaved={load}
            logoUploader={<LogoCard enterprise={enterprise} onChanged={load} />}
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
      </Tabs>
    </PageLayout>
  );
}
