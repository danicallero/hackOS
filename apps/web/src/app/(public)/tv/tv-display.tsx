"use client";

import { EVENTS } from "@hackos/shared/events";
import {
  AlertCircleIcon,
  CalendarDaysIcon,
  Clock3Icon,
  UsersRoundIcon,
  WifiIcon,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Brand } from "@/components/common/brand";
import { Spinner } from "@/components/common/spinner";
import type {
  PublicAnnouncement,
  PublicEvent,
  PublicSponsor,
} from "@/components/public/public-types";
import { EventTimer } from "@/components/public/timer";
import { type SseEnvelope, useEventSource } from "@/hooks/use-event-source";
import { useFitToViewport } from "@/hooks/use-fit-to-viewport";
import { api } from "@/lib/api";
import { logisticsApi, type PublicScheduleItem } from "@/lib/logistics";
import {
  getAllRoomViews,
  getTvMode,
  type QueueEntry,
  type RoomView,
  type TvMode,
} from "@/lib/queue";
import { cn } from "@/lib/utils";

/** Room-card sizing used to derive the outer grid's column count from the
 * TV's actual measured width, so a portrait screen gets a portrait-shaped
 * grid (fewer, wider columns) instead of a shrunken slice of a landscape
 * layout (H41: adapts to any screen size/aspect ratio). */
const MIN_CARD_WIDTH = 320;
const GRID_GAP = 24;
/** A joint card's internal span never grows past however many outer grid
 * tracks actually exist, so a challenge shared by many rooms wraps
 * internally instead of forcing the grid wider than the screen. */
const MAX_GROUP_SPAN = 4;

function columnsForWidth(width: number) {
  if (!width) return 4;
  return Math.max(1, Math.floor((width + GRID_GAP) / (MIN_CARD_WIDTH + GRID_GAP)));
}

/** The waiting room can legitimately hold more than the couple of teams a
 * card was originally sized for. Rather than cap the list (hiding real
 * teams) or let the card grow without bound (forcing the whole page's
 * fit-to-viewport scale down just because one room got busy), each row
 * shrinks a little per additional team so the card's own height stays
 * roughly bounded regardless of how many are actually waiting. */
const WAITING_ROW_MAX_REM = 1.35;
const WAITING_ROW_MIN_REM = 0.8;
const WAITING_ROW_SHRINK_REM = 0.08;

function waitingRoomRowSize(count: number): string {
  const size = WAITING_ROW_MAX_REM - Math.max(0, count - 1) * WAITING_ROW_SHRINK_REM;
  return `${Math.max(WAITING_ROW_MIN_REM, size)}rem`;
}

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

const MARQUEE_PAUSE_MS = 1600;
const MARQUEE_PIXELS_PER_SECOND = 45;

/** Kiosk-only alternative to a static `truncate` ellipsis (H41: nobody can
 * hover, click, or scroll to read the rest). Only when the text actually
 * overflows its box, scroll it into view on a loop: pause at the start,
 * scroll to reveal the clipped tail, pause there, scroll back, repeat. Text
 * that already fits never animates. */
function MarqueeText({ text, className }: { text: string; className?: string }) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const animationRef = useRef<Animation | null>(null);

  // `text` isn't read in the effect body, but a same-size container swapping
  // to different-length content (e.g. a new presenting team) must still
  // retrigger measurement.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useLayoutEffect(() => {
    const container = containerRef.current;
    const el = textRef.current;
    if (!container || !el) return;

    const setup = () => {
      animationRef.current?.cancel();
      el.style.transform = "translateX(0)";
      const overflow = el.scrollWidth - container.clientWidth;
      if (overflow <= 1) return;
      const travel = (overflow / MARQUEE_PIXELS_PER_SECOND) * 1000;
      const total = MARQUEE_PAUSE_MS * 2 + travel * 2;
      animationRef.current = el.animate(
        [
          { transform: "translateX(0)", offset: 0 },
          { transform: "translateX(0)", offset: MARQUEE_PAUSE_MS / total },
          { transform: `translateX(-${overflow}px)`, offset: (MARQUEE_PAUSE_MS + travel) / total },
          {
            transform: `translateX(-${overflow}px)`,
            offset: (MARQUEE_PAUSE_MS + travel + MARQUEE_PAUSE_MS) / total,
          },
          { transform: "translateX(0)", offset: 1 },
        ],
        { duration: total, iterations: Number.POSITIVE_INFINITY, easing: "ease-in-out" },
      );
    };

    setup();
    const observer = new ResizeObserver(setup);
    observer.observe(container);
    observer.observe(el);
    return () => {
      animationRef.current?.cancel();
      observer.disconnect();
    };
  }, [text]);

  return (
    <span ref={containerRef} className={cn("block overflow-hidden whitespace-nowrap", className)}>
      <span ref={textRef} className="inline-block whitespace-nowrap will-change-transform">
        {text}
      </span>
    </span>
  );
}

/** A room considered "ready" (not paused) vs. paused — mirrors the room's own
 * control-panel state (H35) rather than a TV-only concept. */
function RoomStatusPill({ paused }: { paused: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium",
        paused ? "bg-destructive/10 text-destructive" : "bg-success/15 text-success",
      )}
    >
      <span className={cn("size-1.5 rounded-full", paused ? "bg-destructive" : "bg-success")} />
      {paused ? "Paused" : "Ready"}
    </span>
  );
}

/** Topmost text level on any card: the sponsoring enterprise in bold (the
 * strongest weight on the card), then the challenge it authored underneath —
 * present but not competing with it, never as thin as a muted label. Long
 * challenge titles marquee-scroll rather than wrap and push the card taller. */
function ChallengeHeading({ challenge }: { challenge: RoomView["challenge"] }) {
  if (!challenge) return null;
  return (
    <div className="min-w-0">
      <p className="text-base font-bold tracking-wide uppercase">
        <MarqueeText text={challenge.enterprise_name} />
      </p>
      <h2 className="text-2xl font-medium">
        <MarqueeText text={challenge.title} />
      </h2>
    </div>
  );
}

/** Room name + location — identical treatment everywhere a room appears,
 * standalone or clustered in a joint group, name always bold. */
function RoomHeader({ room }: { room: RoomView }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        {room.room.location && (
          <p className="text-muted-foreground text-sm font-medium">
            <MarqueeText text={room.room.location} />
          </p>
        )}
        <h3 className="text-xl font-bold">
          <MarqueeText text={room.room.name} />
        </h3>
      </div>
      <RoomStatusPill paused={Boolean(room.state?.is_paused)} />
    </div>
  );
}

/** "Current team inside" — in_room and presenting are both physically in the
 * room (H41), only the label differs. */
function PresentingBlock({ active }: { active: QueueEntry | null }) {
  const label =
    active?.status === "presenting" ? "Presenting now" : active ? "In the room" : "Room empty";
  return (
    <div className="bg-muted/60 mt-4 rounded-xl p-4">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</p>
      <p className="mt-1 text-3xl font-semibold">
        <MarqueeText text={active?.repo_name ?? "—"} />
      </p>
    </div>
  );
}

/** "Waiting room teams" — every entry called specifically into this room
 * (status "called"). The room's `max_in_waiting_area` is an operational cap
 * the backend pump already enforces when calling teams in; it's not a
 * display limit, so the TV never hides a team that's actually there. One
 * card (mirroring the "presenting now" block) holds every entry, tinted
 * yellow to read as "waiting" at a glance, with each row sized down a touch
 * as more teams show up so the card doesn't grow unbounded. */
function WaitingRoomList({ room }: { room: RoomView }) {
  const entries = room.called;
  const rowSize = waitingRoomRowSize(entries.length);
  return (
    <div className="bg-warning/20 mt-4 rounded-xl p-4">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        Waiting room
      </p>
      <ol className="mt-1.5 space-y-1">
        {entries.length ? (
          entries.map((entry, index) => (
            <li
              key={entry.id}
              className="flex min-w-0 items-center gap-2 font-semibold"
              style={{ fontSize: rowSize }}
            >
              <span className="tabular-nums">{index + 1}.</span>
              <span className="min-w-0 flex-1">
                <MarqueeText text={entry.repo_name ?? "Team"} />
              </span>
            </li>
          ))
        ) : (
          <li className="text-muted-foreground text-lg font-normal">Empty</li>
        )}
      </ol>
    </div>
  );
}

/** "Topmost queue entry" — shown once per card. For a joint card this is
 * deduped across every member room, since `next` is the same shared-challenge
 * queue for all of them (apps/api/src/modules/queue/reads.ts roomView). */
function NextInQueueFooter({
  entry,
  waitingCount,
}: {
  entry: QueueEntry | null;
  waitingCount: number;
}) {
  return (
    <div className="mt-auto border-t pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Next in queue
        </p>
        {waitingCount > 0 && (
          <span className="text-muted-foreground text-xs tabular-nums">{waitingCount} waiting</span>
        )}
      </div>
      <p className="mt-1 text-xl font-semibold">
        <MarqueeText text={entry?.repo_name ?? "—"} />
      </p>
    </div>
  );
}

/** A room whose challenge (if any) isn't shared with another room. */
function StandaloneRoomCard({ room }: { room: RoomView }) {
  return (
    <article className="flex min-w-0 flex-col rounded-2xl border bg-card p-5 shadow-sm">
      <ChallengeHeading challenge={room.challenge} />
      <div className={room.challenge ? "mt-3" : undefined}>
        <RoomHeader room={room} />
      </div>
      <PresentingBlock active={room.active} />
      <WaitingRoomList room={room} />
      <NextInQueueFooter entry={room.next[0] ?? null} waitingCount={room.next.length} />
    </article>
  );
}

/** Multiple rooms tied to the same joint challenge, clustered into one card:
 * the challenge name and the topmost queue entry each render exactly once,
 * per-room state (name, location, current team, waiting room) repeats. */
function JointGroupCard({ group, maxSpan }: { group: RoomGroup; maxSpan: number }) {
  const shared = group.rooms[0]?.next ?? [];
  return (
    <section
      className="bg-card/60 flex min-w-0 flex-col rounded-2xl border p-5 shadow-sm"
      style={{ gridColumn: `span ${Math.min(group.rooms.length, maxSpan)}` }}
      aria-labelledby={`group-${group.id}-title`}
    >
      <div className="flex items-start justify-between gap-3">
        <div id={`group-${group.id}-title`}>
          <ChallengeHeading challenge={group.challenge} />
        </div>
        <span className="text-muted-foreground shrink-0 text-sm">
          {group.rooms.length} rooms · shared queue
        </span>
      </div>
      <div
        className="mt-4 mb-4 grid gap-4"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
      >
        {group.rooms.map((room) => (
          <div key={room.room.id} className="min-w-0 rounded-xl border bg-card p-4">
            <RoomHeader room={room} />
            <PresentingBlock active={room.active} />
            <WaitingRoomList room={room} />
          </div>
        ))}
      </div>
      <NextInQueueFooter entry={shared[0] ?? null} waitingCount={shared.length} />
    </section>
  );
}

type RoomGroup = {
  id: string;
  challenge: RoomView["challenge"];
  rooms: RoomView[];
};

/** Rooms sharing a challenge collapse into one joint group; a room without a
 * challenge (or the sole room on its challenge) is its own single-room group. */
function groupRoomsByChallenge(rooms: RoomView[]): RoomGroup[] {
  const order: string[] = [];
  const groups = new Map<string, RoomGroup>();
  for (const room of rooms) {
    const key = room.challenge ? `challenge-${room.challenge.id}` : `room-${room.room.id}`;
    let group = groups.get(key);
    if (!group) {
      group = { id: key, challenge: room.challenge, rooms: [] };
      groups.set(key, group);
      order.push(key);
    }
    group.rooms.push(room);
  }
  return order.map((key) => groups.get(key) as RoomGroup);
}

const clockFormatter = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

function RoomsView({ rooms }: { rooms: RoomView[] }) {
  const groups = useMemo(() => groupRoomsByChallenge(rooms), [rooms]);
  const { containerRef, contentRef, scale, containerWidth, contentWidthPercent } =
    useFitToViewport();
  const columns = columnsForWidth(containerWidth);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div ref={containerRef} className="bg-background text-foreground h-dvh w-dvw overflow-hidden">
      <div
        ref={contentRef}
        style={{
          // Pre-widened by 1/scale so the scale() below always lands back on
          // exactly 100% of the container — height may shrink to fit, but
          // width never does (H41: fill the screen edge-to-edge, always).
          width: `${contentWidthPercent}%`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
        className="p-10"
      >
        <header className="flex items-center justify-between gap-6 border-b pb-6">
          <div className="flex items-center gap-3">
            <Brand className="text-xl" />
            <span className="text-muted-foreground text-2xl font-light">·</span>
            <div className="flex items-center gap-2 text-2xl font-semibold">
              <UsersRoundIcon className="size-6" aria-hidden="true" />
              Judging rooms
            </div>
          </div>
          <time
            className="font-mono text-2xl font-semibold tabular-nums"
            dateTime={now.toISOString()}
          >
            {clockFormatter.format(now)}
          </time>
        </header>
        <div className="mt-8">
          {groups.length ? (
            <div
              className="grid gap-6"
              style={{
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                gridAutoFlow: "dense",
              }}
            >
              {groups.map((group) =>
                group.rooms.length > 1 ? (
                  <JointGroupCard
                    key={group.id}
                    group={group}
                    maxSpan={Math.min(MAX_GROUP_SPAN, columns)}
                  />
                ) : (
                  <StandaloneRoomCard key={group.id} room={group.rooms[0]} />
                ),
              )}
            </div>
          ) : (
            <TvEmpty text="Judging rooms will appear here when they are configured." />
          )}
        </div>
      </div>
    </div>
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

  // The initial snapshot is the only time the display needs every resource.
  // Subsequent SSE updates are intentionally scoped below so React keeps the
  // active view and its unchanged props in place instead of repainting it from
  // a freshly replaced page-wide data object.
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

  const refreshMode = useCallback(async () => {
    try {
      const mode = await getTvMode();
      setData((current) => (current ? { ...current, mode } : current));
      setError(null);
    } catch {
      setError("The display is reconnecting to the event service.");
    }
  }, []);

  const refreshRooms = useCallback(async () => {
    try {
      const rooms = await getAllRoomViews();
      setData((current) => (current ? { ...current, rooms } : current));
      setError(null);
    } catch {
      setError("The display is reconnecting to the event service.");
    }
  }, []);

  const refreshSchedule = useCallback(async () => {
    try {
      const schedule = await logisticsApi.publicSchedule();
      setData((current) => (current ? { ...current, schedule: schedule.items } : current));
      setError(null);
    } catch {
      setError("The display is reconnecting to the event service.");
    }
  }, []);

  const refreshAnnouncements = useCallback(async () => {
    try {
      const announcements = await api.get<{ items: PublicAnnouncement[] }>(
        "/api/announcements/public",
      );
      setData((current) =>
        current ? { ...current, announcements: announcements.items } : current,
      );
      setError(null);
    } catch {
      setError("The display is reconnecting to the event service.");
    }
  }, []);

  const refreshContent = useCallback(
    (event: SseEnvelope) => {
      if (event.type === EVENTS.CONTENT_SCHEDULE_CHANGED) void refreshSchedule();
      if (event.type === EVENTS.CONTENT_ANNOUNCEMENT) void refreshAnnouncements();
    },
    [refreshAnnouncements, refreshSchedule],
  );

  useEventSource("/api/tv/stream", {
    events: [EVENTS.TV_MODE_CHANGED],
    onEvent: () => void refreshMode(),
  });
  useEventSource("/api/queue/stream", {
    events: [EVENTS.QUEUE_ENTRY_CHANGED, EVENTS.QUEUE_ROOM_CHANGED],
    onEvent: () => void refreshRooms(),
  });
  useEventSource("/api/content/stream", {
    events: [EVENTS.CONTENT_ANNOUNCEMENT, EVENTS.CONTENT_SCHEDULE_CHANGED],
    onEvent: refreshContent,
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
