"use client";

import { CAPABILITIES } from "@hackos/shared/capabilities";
import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { useParams } from "next/navigation";
import { useCallback } from "react";
import { CertificatesPanel } from "@/components/certificates/certificates-panel";
import { BackLink } from "@/components/common/back-link";
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { PageLayout } from "@/components/common/page-layout";
import { Spinner } from "@/components/common/spinner";
import { StaleDataNotice } from "@/components/common/stale-data-notice";
import { TabBar } from "@/components/common/tab-bar";
import { Tabs, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import { useFoodIntolerances } from "@/hooks/use-food-intolerances";
import { useLiveQuery } from "@/hooks/use-live-query";
import { api, isNotFoundError } from "@/lib/api";
import { apiErrorText } from "@/lib/api-error-text";
import { useLocale } from "@/lib/i18n";
import { useCan } from "@/lib/session";
import type { UserDetail } from "@/lib/types";
import { useUrlTab } from "@/lib/url-tab";
import { ApplicationTab } from "./application-tab";
import { LogsTab } from "./logs-tab";
import { OverviewTab } from "./overview-tab";
import { PermissionsTab } from "./permissions-tab";
import { PhysicalActivity } from "./physical-activity";
import { PresenceSection } from "./presence-tab";
import { ProfileHeader } from "./profile-header";
import { ProjectsTab } from "./projects-tab";
import { PublicProfileTab } from "./public-profile-tab";
import { QrTab } from "./qr-tab";

const USER_TABS = [
  "overview",
  "public-profile",
  "access",
  "attendance",
  "activity",
  "application",
  "projects",
] as const;

export default function UserProfilePage() {
  const { t } = useLocale();
  const params = useParams<{ id: string }>();
  const userId = Number(params.id);
  const canCertificates = useCan(CAPABILITIES.PRESENCE_MANAGE);
  const { tab, setTab } = useUrlTab({
    values: USER_TABS,
    defaultValue: "overview",
    aliases: { qr: "access", permissions: "access", presence: "attendance" },
  });

  const validId = Number.isFinite(userId);
  const {
    data: user,
    error,
    loading,
    stale,
    refetch,
  } = useLiveQuery(
    (signal) => api.get<UserDetail>(`/api/users/${userId}`, { signal }),
    domainScope(SSE_TOPICS.IDENTITY),
    [EVENTS.DOMAIN_CHANGED],
    { resourceKey: ["users", "detail", userId], enabled: validId },
  );
  const { intolerances, error: dictionaryError, reload: reloadDictionary } = useFoodIntolerances();
  const load = useCallback(async () => refetch(), [refetch]);

  if (validId && loading && !error) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (!validId || !user || (error && isNotFoundError(error))) {
    if (validId && error && !isNotFoundError(error)) {
      return (
        <ContextualError
          message={apiErrorText(error, t, t("couldNotLoadUserProfile"))}
          onRetry={() => refetch()}
        />
      );
    }
    return (
      <div className="space-y-6">
        <BackLink href="/users" label={t("users")} />
        <EmptyState
          title={t("userNotFoundTitle")}
          description={
            error ? apiErrorText(error, t, t("profileNotLoaded")) : t("profileNotLoaded")
          }
        />
      </div>
    );
  }

  return (
    <PageLayout>
      {stale && <StaleDataNotice onRetry={() => refetch()} />}
      {dictionaryError ? (
        <ContextualError message={t("couldNotLoadDictionary")} onRetry={reloadDictionary} />
      ) : null}
      <ProfileHeader user={user} onPhotoChanged={load} />

      <Tabs value={tab} onValueChange={setTab}>
        <TabBar aria-label={t("profileSections")}>
          <TabsTrigger value="overview">{t("tabOverview")}</TabsTrigger>
          <TabsTrigger value="public-profile">{t("publicProfileTitle")}</TabsTrigger>
          <TabsTrigger value="access">{t("accessTab")}</TabsTrigger>
          <TabsTrigger value="attendance">{t("attendanceTab")}</TabsTrigger>
          <TabsTrigger value="activity">{t("tabLogs")}</TabsTrigger>
          <TabsTrigger value="application">{t("tabApplication")}</TabsTrigger>
          <TabsTrigger value="projects">{t("projects")}</TabsTrigger>
        </TabBar>

        <TabsContent value="overview" className="pt-2">
          <OverviewTab user={user} intolerances={intolerances} onUpdated={load} />
        </TabsContent>
        <TabsContent value="public-profile" className="pt-2">
          <PublicProfileTab key={user.id} user={user} onUpdated={load} />
        </TabsContent>
        <TabsContent value="access" className="grid items-start gap-6 pt-2 xl:grid-cols-2">
          <QrTab user={user} />
          <PermissionsTab user={user} onChanged={load} />
        </TabsContent>
        <TabsContent value="attendance" className="pt-2">
          <div className="space-y-6">
            <PresenceSection userId={user.id} />
            {canCertificates ? <CertificatesPanel staffUserId={user.id} /> : null}
            <details className="group rounded-lg border">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-3 rounded-lg p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:p-5">
                <div className="min-w-0">
                  <h2 className="type-section-title text-balance">{t("activityPasses")}</h2>
                  <p className="text-muted-foreground mt-1 text-pretty text-sm">
                    {t("activityPassesProjectionDesc")}
                  </p>
                </div>
                <CaretDownIcon
                  className="text-muted-foreground mt-1 size-5 shrink-0 transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="border-border border-t p-4 sm:p-5">
                <PhysicalActivity userId={user.id} embedded />
              </div>
            </details>
          </div>
        </TabsContent>
        <TabsContent value="activity" className="pt-2">
          <LogsTab userId={user.id} />
        </TabsContent>
        <TabsContent value="application" className="pt-2">
          <ApplicationTab userId={user.id} />
        </TabsContent>
        <TabsContent value="projects" className="pt-2">
          <ProjectsTab userId={user.id} />
        </TabsContent>
      </Tabs>
    </PageLayout>
  );
}
