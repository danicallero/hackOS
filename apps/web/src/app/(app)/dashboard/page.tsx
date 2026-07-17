"use client";

import {
  BellIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  GavelIcon,
  MapPinIcon,
  SettingsIcon,
  TicketIcon,
  TrophyIcon,
  WalletCardsIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/common/page-header";
import { QueueStatusBadge } from "@/components/common/queue-status-badge";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import type { PublicAnnouncement, PublicEvent } from "@/components/public/public-types";
import { EventPhaseDisplay, useEventPhase } from "@/components/public/timer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { LOCALE_CODES, useLocale } from "@/lib/i18n";
import { logisticsApi, type PublicScheduleItem } from "@/lib/logistics";
import { getMyQueue, type MyQueueEntry } from "@/lib/queue";
import { useMe } from "@/lib/session";
import { type MyResponseSummary, statusLabel, statusTone } from "../my-applications/lib";

type DashboardData = {
  event: PublicEvent | null;
  schedule: PublicScheduleItem[];
  announcements: PublicAnnouncement[];
  applications: MyResponseSummary[];
  queue: MyQueueEntry[];
};

const initialData: DashboardData = {
  event: null,
  schedule: [],
  announcements: [],
  applications: [],
  queue: [],
};

function dateTime(value: string, timezone: string, language: "es" | "gl" | "en") {
  return new Intl.DateTimeFormat(LOCALE_CODES[language], {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
}

export default function DashboardPage() {
  const me = useMe();
  const { language, t } = useLocale();
  const [data, setData] = useState<DashboardData>(initialData);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [event, schedule, announcements, applications, queue] = await Promise.all([
      api.get<PublicEvent>("/api/public/event").catch(() => null),
      logisticsApi.publicSchedule().catch(() => ({ items: [] as PublicScheduleItem[] })),
      api
        .get<{ items: PublicAnnouncement[] }>("/api/announcements/public")
        .catch(() => ({ items: [] as PublicAnnouncement[] })),
      api
        .get<{ responses: MyResponseSummary[] }>("/api/me/applications")
        .catch(() => ({ responses: [] as MyResponseSummary[] })),
      getMyQueue().catch(() => [] as MyQueueEntry[]),
    ]);
    setData({
      event,
      schedule: schedule.items,
      announcements: announcements.items,
      applications: applications.responses,
      queue,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const phase = useEventPhase(data.event);
  const nextActivity = useMemo(() => {
    const now = Date.now();
    return data.schedule
      .filter((item) => new Date(item.endsAt).getTime() >= now)
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0];
  }, [data.schedule]);
  const attentionQueues = useMemo(
    () =>
      data.queue
        .filter(
          (entry) =>
            !["completed", "presenting", "no_show", "cancelled", "disqualified"].includes(
              entry.status,
            ),
        )
        .sort(
          (a, b) =>
            (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER),
        )
        .slice(0, 3),
    [data.queue],
  );
  if (!me) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${t("welcome")}${me.name ? `, ${me.name}` : ""}`}
        description={data.event?.tagline ?? undefined}
      />

      {loading ? (
        <div className="flex justify-center py-16" role="status" aria-busy="true">
          <Spinner className="size-6" />
          <span className="sr-only">{t("loadingDashboard")}</span>
        </div>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-balance text-lg">
                    {data.event?.name ?? "hackOS"}
                  </CardTitle>
                  <p className="text-muted-foreground text-pretty mt-1 text-sm">
                    {t("eventStatus")}
                  </p>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/timetable">
                    <CalendarDaysIcon className="size-4" aria-hidden="true" />
                    {t("viewSchedule")}
                  </Link>
                </Button>
              </CardHeader>
              <CardContent>
                {phase.kind !== "none" ? (
                  <EventPhaseDisplay
                    phase={phase}
                    className="mt-1 block font-mono text-3xl font-semibold tabular-nums"
                  />
                ) : (
                  <p className="text-muted-foreground text-sm">{t("eventTimingPending")}</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-balance text-lg">{t("nextUp")}</CardTitle>
                  <p className="text-muted-foreground text-pretty mt-1 text-sm">
                    {t("nextUpDescription")}
                  </p>
                </div>
                <CalendarDaysIcon
                  className="text-muted-foreground size-5 shrink-0"
                  aria-hidden="true"
                />
              </CardHeader>
              <CardContent>
                {nextActivity ? (
                  <div className="space-y-1">
                    <p className="font-medium">{nextActivity.title}</p>
                    <p className="text-muted-foreground text-sm tabular-nums">
                      {dateTime(nextActivity.startsAt, data.event?.timezone ?? "UTC", language)}
                    </p>
                    {nextActivity.location && (
                      <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
                        <MapPinIcon className="size-3.5" aria-hidden="true" />
                        {nextActivity.location}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">{t("noUpcomingSchedule")}</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)]">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-2.5">
                  <BellIcon className="text-muted-foreground size-5" aria-hidden="true" />
                  <CardTitle className="text-balance text-lg">{t("latestAnnouncements")}</CardTitle>
                </div>
                <Button asChild variant="ghost" size="sm">
                  <Link href="/inbox">{t("viewAll")}</Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.announcements.length ? (
                  data.announcements.slice(0, 3).map((announcement) => (
                    <article
                      key={announcement.id}
                      className="border-b pb-3 last:border-0 last:pb-0"
                    >
                      <h2 className="text-balance font-medium">{announcement.title}</h2>
                      <p className="text-muted-foreground text-pretty mt-1 line-clamp-2 text-sm">
                        {announcement.body}
                      </p>
                    </article>
                  ))
                ) : (
                  <p className="text-muted-foreground text-sm">{t("noAnnouncementsYet")}</p>
                )}
              </CardContent>
            </Card>

            {(data.applications.length > 0 || attentionQueues.length > 0) && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2.5">
                    <ClipboardListIcon
                      className="text-muted-foreground size-5"
                      aria-hidden="true"
                    />
                    <CardTitle className="text-balance text-lg">
                      {attentionQueues.length ? t("queuePositions") : t("yourStatus")}
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {data.applications.slice(0, 2).map((application) => (
                    <Link
                      key={application.id}
                      href={`/my-applications/${application.application_id}`}
                      className="hover:bg-muted/50 flex items-center justify-between gap-3 rounded-lg border p-3"
                    >
                      <span className="min-w-0 truncate text-sm font-medium">
                        {application.application_name}
                      </span>
                      <StatusBadge tone={statusTone(application.status)} dot={false}>
                        {statusLabel(application.status, t)}
                      </StatusBadge>
                    </Link>
                  ))}
                  {attentionQueues.map((entry) => (
                    <Link
                      key={entry.entryId}
                      href="/my-queue"
                      className="hover:bg-muted/50 flex items-center justify-between gap-3 rounded-lg border p-3"
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <TicketIcon className="size-4 shrink-0" aria-hidden="true" />
                          <span className="truncate">{entry.challengeTitle}</span>
                        </span>
                        {entry.position != null && (
                          <span className="text-muted-foreground mt-1 block text-xs tabular-nums">
                            {t("position")} #{entry.position}
                          </span>
                        )}
                      </span>
                      <QueueStatusBadge status={entry.status} />
                    </Link>
                  ))}
                  <Button asChild variant="ghost" className="w-full justify-between">
                    <Link href={attentionQueues.length ? "/my-queue" : "/my-applications"}>
                      {attentionQueues.length ? t("viewQueue") : t("viewApplications")}
                      <ChevronRightIcon className="size-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-balance text-lg">{t("quickActions")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {(me.role === "participant" || me.role === "staff") && (
                <Button asChild variant="outline" className="justify-start">
                  <Link href="/wallet">
                    <WalletCardsIcon className="size-4" aria-hidden="true" />
                    {t("viewTicket")}
                  </Link>
                </Button>
              )}
              {me.role === "sponsor" && (
                <Button asChild variant="outline" className="justify-start">
                  <Link href="/challenges">
                    <TrophyIcon className="size-4" aria-hidden="true" />
                    {t("challenges")}
                  </Link>
                </Button>
              )}
              {me.role === "judge" && (
                <Button asChild variant="outline" className="justify-start">
                  <Link href="/judging">
                    <GavelIcon className="size-4" aria-hidden="true" />
                    {t("judging")}
                  </Link>
                </Button>
              )}
              {(me.role === "staff" || me.role === "admin") && (
                <Button asChild variant="outline" className="justify-start">
                  <Link href="/logistics">
                    <TicketIcon className="size-4" aria-hidden="true" />
                    {t("logistics")}
                  </Link>
                </Button>
              )}
              {me.role === "admin" && (
                <>
                  <Button asChild variant="outline" className="justify-start">
                    <Link href="/queue">
                      <TicketIcon className="size-4" aria-hidden="true" />
                      {t("queueOperations")}
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="justify-start">
                    <Link href="/settings/event">
                      <SettingsIcon className="size-4" aria-hidden="true" />
                      {t("eventSettings")}
                    </Link>
                  </Button>
                </>
              )}
              <Button asChild variant="outline" className="justify-start">
                <Link href="/timetable">
                  <CalendarDaysIcon className="size-4" aria-hidden="true" />
                  {t("viewSchedule")}
                </Link>
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
