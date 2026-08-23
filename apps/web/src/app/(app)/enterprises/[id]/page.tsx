"use client";

// Enterprise detail (H43/H44): admins with sponsors:manage edit a sponsor's
// full profile — name, links, tier, reveal window/visibility — and manage its
// logo. The logo is uploaded via a presigned PUT (H44 object storage); the API
// sets logo_url to the resulting public URL server-side, so we just reload.

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { EVENTS } from "@hackos/shared/events";
import { Building2Icon } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { BackLink } from "@/components/common/back-link";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Spinner } from "@/components/common/spinner";
import { SponsorLogo } from "@/components/common/sponsor-logo";
import { TabBar } from "@/components/common/tab-bar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import { useUrlTab } from "@/lib/url-tab";
import { type Enterprise, initials } from "../shared";

const optionalUrl = z.string().url("Enter a valid URL").or(z.literal(""));
const optionalPositiveInt = z
  .string()
  .refine((v) => v === "" || (/^\d+$/.test(v) && Number(v) > 0), "Must be a positive number");

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const editSchema = z.object({
  name: z.string().min(1, "Required").max(200),
  website: optionalUrl,
  logoUrl: optionalUrl,
  logoNegativeUrl: optionalUrl,
  description: z.string().max(2000),
  tierId: optionalPositiveInt,
  displayPriority: optionalPositiveInt,
  visibility: z.enum(["visible", "hidden"]),
  availableFrom: z.string(),
});

import { ChallengesSummaryCard, EditCard, LogoCard, MembersCard } from "./enterprise-cards";
import { InviteLinksCard } from "./invite-links-card";
import { EnterpriseOverviewCard } from "./overview-card";

export default function EnterpriseDetailPage() {
  const { t } = useLocale();
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const canManage = useCan(CAPABILITIES.SPONSORS_MANAGE);
  const enterpriseTabs = canManage
    ? (["overview", "profile", "challenges", "members", "invitations"] as const)
    : (["overview", "profile", "challenges"] as const);
  const { tab, setTab } = useUrlTab({ values: enterpriseTabs, defaultValue: "overview" });

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
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

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
        {canManage && <BackLink href="/enterprises" label={t("backToEnterprises")} />}
        <EmptyState
          icon={Building2Icon}
          title={t("enterpriseNotFoundTitle")}
          description={errorMsg || t("enterpriseNotLoadedDesc")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {canManage && <BackLink href="/enterprises" label={t("backToEnterprises")} />}
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
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabBar aria-label={t("enterpriseSections")} className="w-full justify-start">
          <TabsTrigger value="overview">{t("tabOverview")}</TabsTrigger>
          <TabsTrigger value="profile">{t("enterpriseProfileTab")}</TabsTrigger>
          <TabsTrigger value="challenges">{t("challenges")}</TabsTrigger>
          {canManage && <TabsTrigger value="members">{t("membersTitle")}</TabsTrigger>}
          {canManage && <TabsTrigger value="invitations">{t("invitationManagement")}</TabsTrigger>}
        </TabBar>
        <TabsContent value="overview" className="space-y-6 pt-2">
          <EnterpriseOverviewCard
            enterprise={enterprise}
            canManage={canManage}
            onOpenProfile={() => setTab("profile")}
          />
        </TabsContent>
        <TabsContent value="profile" className="space-y-6 pt-2">
          <LogoCard enterprise={enterprise} onChanged={load} />
          <EditCard enterprise={enterprise} canManage={canManage} onSaved={load} />
        </TabsContent>
        <TabsContent value="challenges" className="pt-2">
          <ChallengesSummaryCard enterprise={enterprise} canManage={canManage} />
        </TabsContent>
        {canManage && (
          <TabsContent value="members" className="pt-2">
            <MembersCard enterpriseId={enterprise.id} />
          </TabsContent>
        )}
        {canManage && (
          <TabsContent value="invitations" className="pt-2">
            <InviteLinksCard enterpriseId={enterprise.id} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
