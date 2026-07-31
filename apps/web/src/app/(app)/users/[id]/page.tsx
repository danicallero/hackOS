"use client";

import { EVENTS } from "@hackos/shared/events";
import { ChevronDownIcon, UsersIcon } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { BackLink } from "@/components/common/back-link";
import { EmptyState } from "@/components/common/empty-state";
import { Spinner } from "@/components/common/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAutoRefresh } from "@/hooks/use-auto-refresh";
import { ApiError, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { Intolerance, UserDetail } from "@/lib/types";

import { ApplicationTab } from "./application-tab";
import { LogsTab } from "./logs-tab";
import { OverviewTab } from "./overview-tab";
import { PermissionsTab } from "./permissions-tab";
import { PhysicalActivity } from "./physical-activity";
import { PresenceSection } from "./presence-tab";
import { ProfileHeader } from "./profile-header";
import { ProjectsTab } from "./projects-tab";
import { QrTab } from "./qr-tab";
import { TAB_VALUES } from "./shared";

export default function UserProfilePage() {
  const { t } = useLocale();
  const params = useParams<{ id: string }>();
  const userId = Number(params.id);
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const initialTab =
    requestedTab && (TAB_VALUES as readonly string[]).includes(requestedTab)
      ? requestedTab
      : "overview";

  const [user, setUser] = useState<UserDetail | null>(null);
  const [intolerances, setIntolerances] = useState<Intolerance[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async () => {
    setStatus((current) => (current === "ready" ? "ready" : "loading"));
    try {
      const data = await api.get<UserDetail>(`/api/users/${userId}`);
      setUser(data);
      setStatus("ready");
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : t("couldNotLoadUserProfile"));
      setStatus("error");
    }
  }, [userId, t]);

  // Soft, in-place refresh instead of a hard reload when this user's profile
  // changes elsewhere.
  const liveRefresh = useAutoRefresh("/api/events/stream", [EVENTS.DATA_CHANGED]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: liveRefresh is a ping-only nonce, intentionally added to retrigger this effect.
  useEffect(() => {
    if (Number.isFinite(userId)) void load();
    else setStatus("error");
  }, [userId, load, liveRefresh]);

  useEffect(() => {
    api
      .get<{ intolerances: Intolerance[] }>("/api/public/food-intolerances")
      .then((r) => setIntolerances(r.intolerances))
      .catch(() => setIntolerances([]));
  }, []);

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="size-6" />
      </div>
    );
  }

  if (status === "error" || !user) {
    return (
      <div className="space-y-6">
        <BackLink href="/users" label={t("backToUsers")} />
        <EmptyState
          icon={UsersIcon}
          title={t("userNotFoundTitle")}
          description={errorMsg || t("profileNotLoaded")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink href="/users" label={t("backToUsers")} />
      <ProfileHeader user={user} />

      <Tabs defaultValue={initialTab}>
        <TabsList
          aria-label={t("profileSections")}
          className="w-full max-w-3xl justify-start overflow-x-auto"
        >
          <TabsTrigger className="flex-none" value="overview">
            {t("tabOverview")}
          </TabsTrigger>
          <TabsTrigger className="flex-none" value="qr">
            {t("qrCodes")}
          </TabsTrigger>
          <TabsTrigger className="flex-none" value="permissions">
            {t("permissions")}
          </TabsTrigger>
          <TabsTrigger className="flex-none" value="presence">
            {t("presence")}
          </TabsTrigger>
          <TabsTrigger className="flex-none" value="activity">
            {t("tabLogs")}
          </TabsTrigger>
          <TabsTrigger className="flex-none" value="application">
            {t("tabApplication")}
          </TabsTrigger>
          <TabsTrigger className="flex-none" value="projects">
            {t("projects")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="pt-2">
          <OverviewTab user={user} intolerances={intolerances} onUpdated={load} />
        </TabsContent>
        <TabsContent value="qr" className="pt-2">
          <QrTab user={user} />
        </TabsContent>
        <TabsContent value="permissions" className="pt-2">
          <PermissionsTab user={user} onChanged={load} />
        </TabsContent>
        <TabsContent value="presence" className="pt-2">
          <div className="space-y-6">
            <PresenceSection userId={user.id} refreshKey={liveRefresh} />
            <details className="group rounded-lg border">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-3 rounded-lg p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:p-5">
                <div className="min-w-0">
                  <h2 className="type-section-title text-balance">{t("activityPasses")}</h2>
                  <p className="text-muted-foreground mt-1 text-pretty text-sm">
                    {t("activityPassesProjectionDesc")}
                  </p>
                </div>
                <ChevronDownIcon
                  className="text-muted-foreground mt-1 size-5 shrink-0 transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="border-border border-t p-4 sm:p-5">
                <PhysicalActivity userId={user.id} refreshKey={liveRefresh} embedded />
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
    </div>
  );
}
