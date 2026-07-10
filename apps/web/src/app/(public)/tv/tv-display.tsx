"use client";

import { EVENTS } from "@hackos/shared/events";
import {
  AlertCircleIcon,
  CalendarDaysIcon,
  Clock3Icon,
  UsersRoundIcon,
  WifiIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Brand } from "@/components/common/brand";
import { Spinner } from "@/components/common/spinner";
import type {
  PublicAnnouncement,
  PublicEvent,
  PublicSponsor,
} from "@/components/public/public-types";
import { EventTimer } from "@/components/public/timer";
import { useEventSource } from "@/hooks/use-event-source";
import { api } from "@/lib/api";
import { logisticsApi, type PublicScheduleItem } from "@/lib/logistics";
import { getAllRoomViews, getTvMode, type RoomView, type TvMode } from "@/lib/queue";

type TvData = {
  mode: TvMode;
  event: PublicEvent;
  rooms: RoomView[];
  schedule: PublicScheduleItem[];
  sponsors: PublicSponsor[];
  announcements: PublicAnnouncement[];
};

function textPayload(payload: unknown, key: string): string | null {
  return typeof payload === "object" &&
    payload !== null &&
    typeof (payload as Record<string, unknown>)[key] === "string"
    ? String((payload as Record<string, unknown>)[key])
    : null;
}

function RoomCard({ room }: { room: RoomView }) {
  const active = room.active ?? null;
  const waiting = room.called.slice(active ? 0 : 1).concat(room.next).slice(0, 3);
  const activeLabel = active
    ? "Presenting now"
    : room.called[0]
      ? "Please go to the room"
      : "Waiting for the next team";
  const activeEntry = active ?? room.called[0] ?? null;
  return (
    <article className="min-w-0 rounded-2xl border bg-card p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-muted-foreground text-base">{room.room.location ?? "Judging room"}</p>
          <h3 className="text-balance mt-1 text-3xl font-semibold">{room.room.name}</h3>
        </div>
        {room.state?.is_paused && (
          <span className="rounded-full border px-3 py-1 text-sm">Paused</span>
        )}
      </div>
      <div className="mt-8 rounded-xl bg-muted/60 p-4">
        <p className="text-muted-foreground text-base">{activeLabel}</p>
        <p className="mt-1 truncate text-4xl font-semibold">
          {activeEntry?.repo_name ?? "—"}
        </p>
      </div>
      <div className="mt-6 border-t pt-4">
        <p className="text-muted-foreground text-base">Up next</p>
        <ol className="mt-3 space-y-2">
          {waiting.length ? (
            waiting.map((entry, index) => (
              <li key={entry.id} className="flex min-w-0 items-center gap-3 text-xl">
                <span className="text-muted-foreground tabular-nums">{index + 1}</span>
                <span className="truncate">{entry.repo_name ?? "Team"}</span>
              </li>
            ))
          ) : (
            <li className="text-muted-foreground text-xl">No teams in queue</li>
          )}
        </ol>
      </div>
    </article>
  );
}

function RoomsView({ rooms }: { rooms: RoomView[] }) {
  const groups = useMemo(() => {
    const result = new Map<string, { id: string; title: string; rooms: RoomView[] }>();
    for (const room of rooms) {
      const key = room.challenge ? `challenge-${room.challenge.id}` : "unassigned";
      const group = result.get(key) ?? {
        id: key,
        title: room.challenge?.title ?? "Other rooms",
        rooms: [],
      };
      group.rooms.push(room);
      result.set(key, group);
    }
    return [...result.values()];
  }, [rooms]);
  return (
    <TvFrame title="Judging rooms" icon={UsersRoundIcon}>
      {groups.length ? (
        <div className="space-y-9">
          {groups.map((group) => (
            <section key={group.id} aria-labelledby={`challenge-${group.id}`}>
              <h2 id={`challenge-${group.id}`} className="text-balance mb-4 text-3xl font-semibold">
                {group.title}
              </h2>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {group.rooms.map((room) => (
                  <RoomCard key={room.room.id} room={room} />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <TvEmpty text="Judging rooms will appear here when they are configured." />
      )}
    </TvFrame>
  );
}

function TvFrame({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof UsersRoundIcon;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background p-8 text-foreground lg:p-12">
      <header className="flex items-center justify-between gap-6 border-b pb-6">
        <Brand className="text-xl" />
        <div className="flex items-center gap-3">
          <Icon className="size-6" aria-hidden="true" />
          <h1 className="text-balance text-3xl font-semibold">{title}</h1>
        </div>
      </header>
      <div className="mx-auto max-w-[110rem] py-9">{children}</div>
    </div>
  );
}
function TvEmpty({ text }: { text: string }) {
  return (
    <div className="grid min-h-80 place-items-center rounded-2xl border text-center text-2xl text-muted-foreground">
      {text}
    </div>
  );
}

function ScheduleView({
  schedule,
  timezone,
}: {
  schedule: PublicScheduleItem[];
  timezone: string;
}) {
  const format = (date: string) =>
    new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    }).format(new Date(date));
  return (
    <TvFrame title="Schedule" icon={CalendarDaysIcon}>
      {schedule.length ? (
        <ol className="divide-y rounded-2xl border px-6">
          {schedule.map((item) => (
            <li key={item.id} className="grid gap-3 py-6 md:grid-cols-[14rem_1fr_auto]">
              <time className="text-xl tabular-nums text-muted-foreground">
                {format(item.startsAt)}
              </time>
              <div>
                <h2 className="text-balance text-3xl font-semibold">{item.title}</h2>
                {item.description && (
                  <p className="text-pretty mt-2 text-lg text-muted-foreground">
                    {item.description}
                  </p>
                )}
              </div>
              <p className="text-xl">{item.location}</p>
            </li>
          ))}
        </ol>
      ) : (
        <TvEmpty text="The schedule will appear here when published." />
      )}
    </TvFrame>
  );
}
function SponsorsView({ sponsors }: { sponsors: PublicSponsor[] }) {
  return (
    <TvFrame title="Sponsors" icon={UsersRoundIcon}>
      {sponsors.length ? (
        <ul className="grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-4">
          {sponsors.map((sponsor) => (
            <li
              key={sponsor.id}
              className="flex min-h-52 items-center justify-center rounded-2xl border bg-card p-8 shadow-sm"
            >
              {sponsor.logoUrl ? (
                // biome-ignore lint/performance/noImgElement: sponsor logos use the deployment-configured public object-store host.
                <img
                  src={sponsor.logoUrl}
                  alt={sponsor.name}
                  className="max-h-28 max-w-full object-contain"
                />
              ) : (
                <span className="text-center text-2xl font-semibold">{sponsor.name}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <TvEmpty text="Sponsors will appear here when published." />
      )}
    </TvFrame>
  );
}
function WifiView({ payload }: { payload: unknown }) {
  const ssid = textPayload(payload, "ssid") ?? "Wi-Fi details";
  const password = textPayload(payload, "password");
  const instructions = textPayload(payload, "instructions");
  return (
    <TvFrame title="Wi-Fi" icon={WifiIcon}>
      <div className="mx-auto max-w-4xl rounded-2xl border bg-card p-10 text-center shadow-sm">
        <p className="text-muted-foreground text-xl">Network</p>
        <p className="mt-2 break-words text-5xl font-semibold">{ssid}</p>
        {password && (
          <>
            <p className="text-muted-foreground mt-10 text-xl">Password</p>
            <p className="mt-2 break-all font-mono text-4xl font-semibold tabular-nums">
              {password}
            </p>
          </>
        )}
        {instructions && (
          <p className="text-pretty mt-10 text-xl text-muted-foreground">{instructions}</p>
        )}
      </div>
    </TvFrame>
  );
}
function TimerView({ event, payload }: { event: PublicEvent; payload: unknown }) {
  const endsAt = textPayload(payload, "endsAt") ?? event.hackingEndsAt;
  const label = textPayload(payload, "label") ?? "Time remaining";
  return (
    <TvFrame title="Event timer" icon={Clock3Icon}>
      <div className="grid min-h-[60dvh] place-items-center text-center">
        <div>
          <p className="text-3xl text-muted-foreground">{label}</p>
          <EventTimer
            endsAt={endsAt}
            className="mt-5 block font-mono text-7xl font-semibold tabular-nums sm:text-9xl"
          />
        </div>
      </div>
    </TvFrame>
  );
}
function AnnouncementView({
  announcements,
  payload,
}: {
  announcements: PublicAnnouncement[];
  payload: unknown;
}) {
  const title = textPayload(payload, "title");
  const body = textPayload(payload, "body");
  const item =
    title || body ? { title: title ?? "Announcement", body: body ?? "" } : announcements[0];
  return (
    <TvFrame title="Announcement" icon={AlertCircleIcon}>
      {item ? (
        <div className="grid min-h-[60dvh] place-items-center text-center">
          <article className="max-w-5xl">
            <h2 className="text-balance text-6xl font-semibold">{item.title}</h2>
            <p className="text-pretty mt-8 whitespace-pre-wrap text-3xl text-muted-foreground">
              {item.body}
            </p>
          </article>
        </div>
      ) : (
        <TvEmpty text="There are no active announcements." />
      )}
    </TvFrame>
  );
}

export function TvDisplay() {
  const [data, setData] = useState<TvData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    try {
      const [mode, event, rooms, schedule, sponsorResult, announcementResult] = await Promise.all([
        getTvMode(),
        api.get<PublicEvent>("/api/public/event"),
        getAllRoomViews(),
        logisticsApi.publicSchedule(),
        api.get<{ items: PublicSponsor[] }>("/api/public/sponsors"),
        api.get<{ items: PublicAnnouncement[] }>("/api/announcements/public"),
      ]);
      // A slower older response must never overwrite the state obtained after
      // an SSE event (for example, a mode change followed by a queue update).
      if (currentRequest !== requestId.current) return;
      setData({
        mode,
        event,
        rooms,
        schedule: schedule.items,
        sponsors: sponsorResult.items,
        announcements: announcementResult.items,
      });
      setError(null);
    } catch {
      if (currentRequest === requestId.current) {
        setError("The display is reconnecting to the event service.");
      }
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEventSource("/api/tv/stream", {
    events: [EVENTS.TV_MODE_CHANGED],
    onEvent: () => void load(),
  });
  useEventSource("/api/queue/stream", {
    events: [EVENTS.QUEUE_ENTRY_CHANGED, EVENTS.QUEUE_ROOM_CHANGED],
    onEvent: () => void load(),
  });
  useEventSource("/api/content/stream", {
    events: [EVENTS.CONTENT_ANNOUNCEMENT, EVENTS.CONTENT_SCHEDULE_CHANGED],
    onEvent: () => void load(),
  });
  if (!data && !error)
    return (
      <div className="grid min-h-dvh place-items-center" role="status" aria-busy="true">
        <Spinner className="size-10" />
        <span className="sr-only">Loading TV display</span>
      </div>
    );
  if (!data)
    return (
      <div className="grid min-h-dvh place-items-center p-8 text-center text-2xl text-muted-foreground">
        {error}
      </div>
    );
  if (data.mode.mode === "schedule")
    return <ScheduleView schedule={data.schedule} timezone={data.event.timezone} />;
  if (data.mode.mode === "sponsors") return <SponsorsView sponsors={data.sponsors} />;
  if (data.mode.mode === "announcement")
    return <AnnouncementView announcements={data.announcements} payload={data.mode.payload} />;
  if (data.mode.mode === "wifi") return <WifiView payload={data.mode.payload} />;
  if (data.mode.mode === "timer")
    return <TimerView event={data.event} payload={data.mode.payload} />;
  return <RoomsView rooms={data.rooms} />;
}
