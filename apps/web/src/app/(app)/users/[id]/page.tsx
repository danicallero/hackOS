"use client";

import { EVENTS } from "@hackos/shared/events";
import { ArrowLeftIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
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
        <BackLink />
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
      <BackLink />
      <ProfileHeader user={user} />

      <Tabs defaultValue={initialTab}>
        <TabsList className="w-full max-w-3xl">
          <TabsTrigger value="overview">{t("tabOverview")}</TabsTrigger>
          <TabsTrigger value="qr">QR</TabsTrigger>
          <TabsTrigger value="permissions">{t("permissions")}</TabsTrigger>
          <TabsTrigger value="presence">{t("presence")}</TabsTrigger>
          <TabsTrigger value="activity">{t("tabLogs")}</TabsTrigger>
          <TabsTrigger value="application">{t("tabApplication")}</TabsTrigger>
          <TabsTrigger value="projects">{t("projects")}</TabsTrigger>
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
            <PresenceSection userId={user.id} />
            <PhysicalActivity userId={user.id} />
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

export function BackLink() {
  const { t } = useLocale();
  return (
    <Link
      href="/users"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
    >
      <ArrowLeftIcon className="size-4" />
      {t("backToUsers")}
    </Link>
  );
}
