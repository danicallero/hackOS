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
import { ContextualError } from "@/components/common/contextual-error";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { QueueStatusBadge } from "@/components/common/queue-status-badge";
import { SectionCard } from "@/components/common/section-card";
import { Spinner } from "@/components/common/spinner";
import { StatusBadge } from "@/components/common/status-badge";
import type { PublicAnnouncement, PublicEvent } from "@/components/public/public-types";
import { EventPhaseDisplay, useEventPhase } from "@/components/public/timer";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
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

type DashboardResource = "event" | "schedule" | "announcements" | "applications" | "queue";
type ResourceStatus = "loading" | "success" | "error";
type ResourceStatuses = Record<DashboardResource, ResourceStatus>;
type ResourceErrors = Partial<Record<DashboardResource, string>>;

/** Queue status is an independent personal surface and must survive other read failures (H38). */
const initialStatuses: ResourceStatuses = {
  event: "loading",
  schedule: "loading",
  announcements: "loading",
  applications: "loading",
  queue: "loading",
};

function dateTime(value: string, timezone: string, language: "es" | "gl" | "en") {
  return new Intl.DateTimeFormat(LOCALE_CODES[language], {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(value));
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

function ResourceLoading({ label }: { label: string }) {
  return (
    <div
      className="text-muted-foreground flex items-center gap-2 py-4"
      role="status"
      aria-busy="true"
    >
      <Spinner />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export default function DashboardPage() {
  const me = useMe();
  const { language, t } = useLocale();
  const [data, setData] = useState<DashboardData>(initialData);
  const [loading, setLoading] = useState(true);
  const [statuses, setStatuses] = useState<ResourceStatuses>(initialStatuses);
  const [errors, setErrors] = useState<ResourceErrors>({});

  const setResourceState = useCallback(
    (resource: DashboardResource, status: ResourceStatus, message?: string) => {
      setStatuses((current) => ({ ...current, [resource]: status }));
      setErrors((current) => {
        const next = { ...current };
        if (message) next[resource] = message;
        else delete next[resource];
        return next;
      });
    },
    [],
  );

  const loadEvent = useCallback(async () => {
    setResourceState("event", "loading");
    try {
      const event = await api.get<PublicEvent>("/api/public/event");
      setData((current) => ({ ...current, event }));
      setResourceState("event", "success");
    } catch (error) {
      setResourceState("event", "error", errorMessage(error, t("publicEventUnavailable")));
    }
  }, [setResourceState, t]);

  const loadSchedule = useCallback(async () => {
    setResourceState("schedule", "loading");
    try {
      const schedule = await logisticsApi.publicSchedule();
      setData((current) => ({ ...current, schedule: schedule.items }));
      setResourceState("schedule", "success");
    } catch (error) {
      setResourceState("schedule", "error", errorMessage(error, t("couldNotLoadSchedule")));
    }
  }, [setResourceState, t]);

  const loadAnnouncements = useCallback(async () => {
    setResourceState("announcements", "loading");
    try {
      const announcements = await api.get<{ items: PublicAnnouncement[] }>(
        "/api/announcements/public",
      );
      setData((current) => ({ ...current, announcements: announcements.items }));
      setResourceState("announcements", "success");
    } catch (error) {
      setResourceState(
        "announcements",
        "error",
        errorMessage(error, t("couldNotLoadAnnouncements")),
      );
    }
  }, [setResourceState, t]);

  const loadApplications = useCallback(async () => {
    setResourceState("applications", "loading");
    try {
      const applications = await api.get<{ responses: MyResponseSummary[] }>(
        "/api/me/applications",
      );
      setData((current) => ({ ...current, applications: applications.responses }));
      setResourceState("applications", "success");
    } catch (error) {
      setResourceState(
        "applications",
        "error",
        errorMessage(error, t("couldNotLoadYourApplications")),
      );
    }
  }, [setResourceState, t]);

  const loadQueue = useCallback(async () => {
    setResourceState("queue", "loading");
    try {
      const queue = await getMyQueue();
      setData((current) => ({ ...current, queue }));
      setResourceState("queue", "success");
    } catch (error) {
      setResourceState("queue", "error", errorMessage(error, t("queueLoadError")));
    }
  }, [setResourceState, t]);

  const load = useCallback(async () => {
    await Promise.allSettled([
      loadEvent(),
      loadSchedule(),
      loadAnnouncements(),
      loadApplications(),
      loadQueue(),
    ]);
    setLoading(false);
  }, [loadAnnouncements, loadApplications, loadEvent, loadQueue, loadSchedule]);

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
            <SectionCard
              title={data.event?.name ?? "hackOS"}
              action={
                <Button asChild variant="ghost" size="sm">
                  <Link href="/timetable">
                    <CalendarDaysIcon className="size-4" aria-hidden="true" />
                    {t("viewSchedule")}
                  </Link>
                </Button>
              }
            >
              {statuses.event === "loading" ? (
                <ResourceLoading label={t("loadingPublicEventInfo")} />
              ) : errors.event ? (
                <ContextualError message={errors.event} onRetry={() => void loadEvent()} />
              ) : phase.kind !== "none" ? (
                <EventPhaseDisplay
                  phase={phase}
                  className="block font-mono text-3xl font-semibold tabular-nums"
                />
              ) : (
                <EmptyState icon={CalendarDaysIcon} title={t("eventTimingPending")} />
              )}
            </SectionCard>

            <SectionCard title={t("nextUp")} icon={CalendarDaysIcon}>
              {statuses.schedule === "loading" ? (
                <ResourceLoading label={t("loading")} />
              ) : errors.schedule ? (
                <ContextualError message={errors.schedule} onRetry={() => void loadSchedule()} />
              ) : nextActivity ? (
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
                <EmptyState icon={CalendarDaysIcon} title={t("noUpcomingSchedule")} />
              )}
            </SectionCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,1fr)]">
            <SectionCard
              title={t("latestAnnouncements")}
              icon={BellIcon}
              bodyClassName="space-y-3"
              action={
                <Button asChild variant="ghost" size="sm">
                  <Link href="/inbox">{t("viewAll")}</Link>
                </Button>
              }
            >
              {statuses.announcements === "loading" ? (
                <ResourceLoading label={t("loading")} />
              ) : errors.announcements ? (
                <ContextualError
                  message={errors.announcements}
                  onRetry={() => void loadAnnouncements()}
                />
              ) : data.announcements.length ? (
                data.announcements.slice(0, 3).map((announcement) => (
                  <article key={announcement.id} className="border-b pb-3 last:border-0 last:pb-0">
                    <h3 className="text-balance font-medium">{announcement.title}</h3>
                    <p className="text-muted-foreground text-pretty mt-1 line-clamp-2 text-sm">
                      {announcement.body}
                    </p>
                  </article>
                ))
              ) : (
                <EmptyState icon={BellIcon} title={t("noAnnouncementsYet")} />
              )}
            </SectionCard>

            <SectionCard title={t("yourStatus")} icon={ClipboardListIcon} bodyClassName="space-y-4">
              {statuses.applications === "loading" ? (
                <ResourceLoading label={t("loading")} />
              ) : errors.applications ? (
                <ContextualError
                  message={errors.applications}
                  onRetry={() => void loadApplications()}
                />
              ) : data.applications.length ? (
                <>
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
                  <Button asChild variant="ghost" className="w-full justify-between">
                    <Link href="/my-applications">
                      {t("viewApplications")}
                      <ChevronRightIcon className="size-4" />
                    </Link>
                  </Button>
                </>
              ) : (
                <>
                  <EmptyState
                    icon={ClipboardListIcon}
                    title={t("notAppliedYetTitle")}
                    description={t("notAppliedYetDesc")}
                  />
                  <Button asChild variant="ghost" className="w-full justify-between">
                    <Link href="/my-applications">
                      {t("viewApplications")}
                      <ChevronRightIcon className="size-4" />
                    </Link>
                  </Button>
                </>
              )}
            </SectionCard>

            <SectionCard title={t("queuePositions")} icon={TicketIcon} bodyClassName="space-y-4">
              {statuses.queue === "loading" ? (
                <ResourceLoading label={t("loading")} />
              ) : errors.queue ? (
                <ContextualError message={errors.queue} onRetry={() => void loadQueue()} />
              ) : attentionQueues.length ? (
                <>
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
                    <Link href="/my-queue">
                      {t("viewQueue")}
                      <ChevronRightIcon className="size-4" />
                    </Link>
                  </Button>
                </>
              ) : (
                <>
                  <EmptyState icon={TicketIcon} title={t("noJudgingQueue")} />
                  <Button asChild variant="ghost" className="w-full justify-between">
                    <Link href="/my-queue">
                      {t("viewQueue")}
                      <ChevronRightIcon className="size-4" />
                    </Link>
                  </Button>
                </>
              )}
            </SectionCard>
          </div>

          <SectionCard
            title={t("quickActions")}
            bodyClassName="grid gap-2 space-y-0 sm:grid-cols-2 lg:grid-cols-4"
          >
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
          </SectionCard>
        </>
      )}
    </div>
  );
}
