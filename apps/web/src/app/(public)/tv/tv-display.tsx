"use client";

import { EVENTS } from "@hackos/shared/events";
import { CalendarDaysIcon, MegaphoneIcon, UsersRoundIcon, WifiIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "@/components/common/spinner";
import type {
  PublicAnnouncement,
  PublicEvent,
  PublicSponsor,
} from "@/components/public/public-types";
import { useElementSize } from "@/hooks/use-element-size";
import { useEventSource } from "@/hooks/use-event-source";
import { useFitToViewport } from "@/hooks/use-fit-to-viewport";
import { api } from "@/lib/api";
import { type Translate, useLocale } from "@/lib/i18n";
import { logisticsApi, type PublicScheduleItem, resolveScheduleText } from "@/lib/logistics";
import { getAllRoomViews, type QueueEntry, type RoomView } from "@/lib/queue";
import {
  bestSponsorColumns,
  DEFAULT_ROTATION_SECONDS,
  getTvState,
  getTvVenueConfig,
  liveConfigFrom,
  msUntilNextRotation,
  rotationIndexAt,
  type TvState,
  type TvVenueConfig,
} from "@/lib/tv";
import { cn } from "@/lib/utils";
import { announcementContent } from "./announcement-content";
import { EmbeddedAnnouncement, LiveScreen, ScheduleBlock } from "./live-screen";
import { MarqueeText } from "./marquee-text";
import { SponsorMark } from "./sponsor-mark";
import { TvBody, TvEmpty, TvHeader, TvScreen } from "./tv-screen";
import { WifiQr } from "./wifi-qr";

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

/** Matches the `gap-[1.25em]` on the sponsor wall at the 1x scale it is measured against. */
const SPONSOR_WALL_GAP_PX = 20;

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
  state: TvState;
  event: PublicEvent;
  rooms: RoomView[];
  schedule: PublicScheduleItem[];
  sponsors: PublicSponsor[];
  announcements: PublicAnnouncement[];
  venue: TvVenueConfig | null;
};

type ScreenPlacement = NonNullable<PublicAnnouncement["screenPlacement"]>;

/** Same cadence as the tv library's mode-slot rotation, for a consistent feel
 * across the venue whenever more than one notice shares a placement. */
const ANNOUNCEMENT_ROTATION_MS = DEFAULT_ROTATION_SECONDS * 1000;

/** The public feed is already filtered to the announcement's validity window.
 * When exactly one notice occupies this placement, show it; when several do,
 * rotate through them by wall-clock time (not per-mount state) so every venue
 * display lands on the same one at the same moment. */
export function activeAnnouncement(
  announcements: PublicAnnouncement[],
  placement: ScreenPlacement,
): PublicAnnouncement | undefined {
  const candidates = announcements.filter(
    (announcement) => announcement.screenPlacement === placement,
  );
  if (candidates.length <= 1) return candidates[0];
  const index = Math.floor(Date.now() / ANNOUNCEMENT_ROTATION_MS) % candidates.length;
  return candidates[index];
}

/** A room considered "ready" (not paused) vs. paused — mirrors the room's own
 * control-panel state (H35) rather than a TV-only concept. */
function RoomStatusPill({ paused, t }: { paused: boolean; t: Translate }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium",
        paused ? "bg-destructive/10 text-destructive" : "bg-success/15 text-success",
      )}
    >
      <span className={cn("size-1.5 rounded-full", paused ? "bg-destructive" : "bg-success")} />
      {paused ? t("paused") : t("readyStatus")}
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
 * standalone or clustered in a joint group, name always bold. The
 * ready/paused pill is NOT part of this block: it always belongs in the
 * top-right corner of whichever card this room heads, so callers place it
 * alongside this component rather than nesting it underneath. */
function RoomHeader({ room }: { room: RoomView }) {
  return (
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
  );
}

/** "Current team inside" — in_room and presenting are both physically in the
 * room (H41), only the label differs. */
function PresentingBlock({ active, t }: { active: QueueEntry | null; t: Translate }) {
  const label =
    active?.status === "presenting"
      ? t("presentingNow")
      : active
        ? t("inTheRoom")
        : t("roomEmptyLabel");
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
function WaitingRoomList({ room, t }: { room: RoomView; t: Translate }) {
  const entries = room.called;
  const rowSize = waitingRoomRowSize(entries.length);
  return (
    <div className="bg-warning/20 mt-4 rounded-xl p-4">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {t("waitingRoomButton")}
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
                <MarqueeText text={entry.repo_name ?? t("teamFallback")} />
              </span>
            </li>
          ))
        ) : (
          <li className="text-muted-foreground text-lg font-normal">{t("emptyLabel")}</li>
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
  t,
}: {
  entry: QueueEntry | null;
  waitingCount: number;
  t: Translate;
}) {
  return (
    <div className="mt-auto border-t pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {t("nextInQueue")}
        </p>
        {waitingCount > 0 && (
          <span className="text-muted-foreground text-xs tabular-nums">
            {t("waitingCountSuffix", { count: waitingCount })}
          </span>
        )}
      </div>
      <p className="mt-1 text-xl font-semibold">
        <MarqueeText text={entry?.repo_name ?? "—"} />
      </p>
    </div>
  );
}

/** A room whose challenge (if any) isn't shared with another room. The
 * ready/paused pill always sits in the card's top-right corner — next to the
 * challenge heading when there is one, next to the room header otherwise —
 * matching where it sits on a joint card's per-room mini-cards. */
function StandaloneRoomCard({ room, t }: { room: RoomView; t: Translate }) {
  const pill = <RoomStatusPill paused={Boolean(room.state?.is_paused)} t={t} />;
  return (
    <article className="bg-card flex min-w-0 flex-col rounded-2xl border p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        {room.challenge ? (
          <ChallengeHeading challenge={room.challenge} />
        ) : (
          <RoomHeader room={room} />
        )}
        {pill}
      </div>
      {room.challenge && (
        <div className="mt-3">
          <RoomHeader room={room} />
        </div>
      )}
      <PresentingBlock active={room.active} t={t} />
      <WaitingRoomList room={room} t={t} />
      <NextInQueueFooter entry={room.next[0] ?? null} waitingCount={room.next.length} t={t} />
    </article>
  );
}

/** Multiple rooms tied to the same joint challenge, clustered into one card:
 * the challenge name and the topmost queue entry each render exactly once,
 * per-room state (name, location, current team, waiting room) repeats. */
function JointGroupCard({
  group,
  maxSpan,
  t,
}: {
  group: RoomGroup;
  maxSpan: number;
  t: Translate;
}) {
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
          {t("groupSharedQueue", { count: group.rooms.length })}
        </span>
      </div>
      <div
        className="mt-4 mb-4 grid gap-4"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
      >
        {group.rooms.map((room) => (
          <div key={room.room.id} className="bg-card min-w-0 rounded-xl border p-4">
            <div className="flex items-start justify-between gap-3">
              <RoomHeader room={room} />
              <RoomStatusPill paused={Boolean(room.state?.is_paused)} t={t} />
            </div>
            <PresentingBlock active={room.active} t={t} />
            <WaitingRoomList room={room} t={t} />
          </div>
        ))}
      </div>
      <NextInQueueFooter entry={shared[0] ?? null} waitingCount={shared.length} t={t} />
    </section>
  );
}

type RoomGroup = {
  id: string;
  challenge: RoomView["challenge"];
  rooms: RoomView[];
};

/** Rooms working the same queue collapse into one joint group; a room with no
 * queue (or the sole room on its queue) is its own single-room group. The key
 * is the queue group, not the challenge: rooms serving a shared queue are one
 * card even though several challenges feed it (H46). */
function groupRoomsByChallenge(rooms: RoomView[]): RoomGroup[] {
  const order: string[] = [];
  const groups = new Map<string, RoomGroup>();
  for (const room of rooms) {
    const key = room.challenge ? `queue-${room.challenge.queue_group_id}` : `room-${room.room.id}`;
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

/**
 * The rooms grid keeps its own fitting strategy rather than the font-scale
 * frame the other modes use: its cards are all single-line MarqueeText, which
 * is exactly the case `useFitToViewport` is safe for, and it additionally
 * needs the measured width to choose a column count.
 */
function AnnouncementRoomCard({ announcement }: { announcement: PublicAnnouncement }) {
  const { language, t } = useLocale();
  const content = announcementContent(announcement, language);
  return (
    <article className="border-primary/35 bg-primary/5 flex min-w-0 flex-col rounded-2xl border p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <MegaphoneIcon className="text-primary mt-1 size-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-primary text-xs font-bold tracking-wide uppercase">
            {t("modeAnnouncement")}
          </p>
          <h2 className="mt-1 text-2xl font-medium">
            <MarqueeText text={content.title} />
          </h2>
        </div>
      </div>
      {content.body && (
        <p className="text-muted-foreground mt-4 text-lg">
          <MarqueeText text={content.body} />
        </p>
      )}
    </article>
  );
}

function RoomsView({
  rooms,
  event,
  announcement,
}: {
  rooms: RoomView[];
  event: PublicEvent;
  announcement?: PublicAnnouncement;
}) {
  const { t } = useLocale();
  const groups = useMemo(() => groupRoomsByChallenge(rooms), [rooms]);
  const { containerRef, contentRef, scale, containerWidth, contentWidthPercent } =
    useFitToViewport();
  const columns = columnsForWidth(containerWidth);
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
        className="flex min-h-full flex-col"
      >
        <TvHeader
          compact
          title={t("judgingRoomsTitle")}
          icon={UsersRoundIcon}
          eventName={event.name}
        />
        <div className="min-h-0 flex-1 p-8">
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
                    t={t}
                  />
                ) : (
                  <StandaloneRoomCard key={group.id} room={group.rooms[0]} t={t} />
                ),
              )}
              {announcement && <AnnouncementRoomCard announcement={announcement} />}
            </div>
          ) : (
            <div className="grid min-h-80 grid-cols-1 gap-6">
              {announcement && <AnnouncementRoomCard announcement={announcement} />}
              <div className="grid place-items-center rounded-2xl border text-center text-2xl text-muted-foreground">
                {t("judgingRoomsEmptyDesc")}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScheduleView({
  schedule,
  event,
  announcement,
}: {
  schedule: PublicScheduleItem[];
  event: PublicEvent;
  announcement?: PublicAnnouncement;
}) {
  const { t } = useLocale();
  return (
    <TvScreen>
      <TvHeader title={t("schedule")} icon={CalendarDaysIcon} eventName={event.name} />
      <TvBody className="gap-[1em]">
        {announcement && <EmbeddedAnnouncement announcement={announcement} compact />}
        <ScheduleBlock
          schedule={schedule}
          visible={8}
          timezone={event.timezone}
          grow
          showHeading={false}
        />
      </TvBody>
    </TvScreen>
  );
}

function SponsorsView({
  sponsors,
  event,
  announcement,
}: {
  sponsors: PublicSponsor[];
  event: PublicEvent;
  announcement?: PublicAnnouncement;
}) {
  const { t } = useLocale();
  const { ref, width, height } = useElementSize<HTMLUListElement>();
  const columns = bestSponsorColumns({
    count: sponsors.length,
    width,
    height,
    gap: SPONSOR_WALL_GAP_PX,
    maxColumns: 6,
  });
  return (
    <TvScreen>
      <TvHeader eventName={event.name} />
      <TvBody className="gap-[1em]">
        {sponsors.length ? (
          // The whole screen belongs to the logos here: tiles split it evenly
          // and each logo fills its tile, so few sponsors read as large marks
          // instead of small ones stranded in the middle of a 4K wall.
          <ul
            ref={ref}
            className="grid min-h-0 flex-1 content-center gap-[1.25em]"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {sponsors.map((sponsor) => (
              <li
                key={sponsor.enterpriseId}
                className="bg-card flex aspect-3/2 items-center justify-center overflow-hidden rounded-[0.75em] border p-[2em] shadow-sm"
              >
                <SponsorMark sponsor={sponsor} className="max-h-full max-w-full object-contain" />
              </li>
            ))}
          </ul>
        ) : (
          <TvEmpty text={t("sponsorsEmptyDesc")} />
        )}
        {announcement && <EmbeddedAnnouncement announcement={announcement} compact />}
      </TvBody>
    </TvScreen>
  );
}

/**
 * Full-screen Wi-Fi. Reads the venue's configured credentials first so a
 * scheduled slot can show this with nobody at the control page. Credentials
 * only ever come from the event's venue configuration.
 *
 * Two ways in, side by side and given equal weight: scan the code, or read
 * the credentials. The password is the largest thing on the screen because
 * typing it from across a room is the job this screen exists for — mono,
 * letter-spaced, on its own plate so it never blends into the prose around it.
 */
function WifiView({
  venue,
  event,
  announcement,
}: {
  venue: TvVenueConfig | null;
  event: PublicEvent;
  announcement?: PublicAnnouncement;
}) {
  const { t } = useLocale();
  const ssid = venue?.wifi?.ssid ?? t("wifiDetailsFallback");
  const password = venue?.wifi?.password;
  return (
    <TvScreen>
      {({ portrait }) => (
        <>
          <TvHeader title={t("modeWifi")} icon={WifiIcon} eventName={event.name} />
          <TvBody className="items-center justify-center">
            {/* Two equal ways in — scan it, or read it — set side by side and
                centred as one block, rather than a small card adrift in a
                large screen. The QR's white plate is the only "card" here;
                a second frame around everything would just add noise. */}
            <div
              className={cn(
                "mx-auto grid w-full max-w-[78em] items-center gap-[4em]",
                portrait
                  ? "grid-cols-1 justify-items-center text-center"
                  : "grid-cols-[minmax(0,1fr)_auto]",
              )}
            >
              <div className="flex min-w-0 flex-col gap-[2.5em]">
                <div>
                  <p className="text-muted-foreground text-[1.25em] font-medium tracking-[0.18em] uppercase">
                    {t("networkLabel")}
                  </p>
                  <p className="mt-[0.15em] text-[4.5em] leading-[1.05] font-semibold tracking-[-0.01em] wrap-break-word">
                    {ssid}
                  </p>
                </div>
                {password && (
                  <div>
                    <p className="text-muted-foreground text-[1.25em] font-medium tracking-[0.18em] uppercase">
                      {t("password")}
                    </p>
                    <p className="bg-muted mt-[0.35em] inline-block rounded-[0.4em] px-[0.5em] py-[0.2em] font-mono text-[3.25em] leading-tight font-semibold tracking-[0.02em] break-all">
                      {password}
                    </p>
                  </div>
                )}
              </div>
              {/* Only when the credentials came from venue config: a QR built
                  from a half-typed operator payload would fail to connect
                  anyone. */}
              {venue?.wifi && (
                <div className="flex flex-col items-center gap-[1.25em]">
                  <WifiQr wifi={venue.wifi} size="17em" />
                  <p className="text-muted-foreground text-[1.35em] font-medium tracking-[0.06em]">
                    {t("wifiScanToJoin")}
                  </p>
                </div>
              )}
            </div>
            {announcement && <EmbeddedAnnouncement announcement={announcement} compact />}
          </TvBody>
        </>
      )}
    </TvScreen>
  );
}

function FullscreenAnnouncement({
  announcement,
  event,
}: {
  announcement: PublicAnnouncement;
  event: PublicEvent;
}) {
  const { language } = useLocale();
  const content = announcementContent(announcement, language);
  return (
    <TvScreen>
      <TvHeader eventName={event.name} />
      <TvBody className="items-center justify-center">
        <article className="max-w-[55em] text-center">
          <h1 className="text-[4em] leading-tight font-semibold text-balance">{content.title}</h1>
          {content.body && (
            <p className="text-muted-foreground mt-[0.75em] text-[1.9em] whitespace-pre-wrap text-pretty">
              {content.body}
            </p>
          )}
        </article>
      </TvBody>
    </TvScreen>
  );
}

/**
 * What a rotating slot is showing right now. Driven off the slot's own start
 * time so every screen in the venue flips together, whenever each was
 * switched on, and re-armed for the exact moment of the next flip instead of
 * polling.
 */
function useRotatedState(state: TvState): { mode: TvState["mode"]; payload: unknown } {
  const items = state.slot?.items ?? [];
  const startedAt = state.slot ? new Date(state.slot.startsAt).getTime() : 0;
  const [index, setIndex] = useState(() => rotationIndexAt(items, Date.now() - startedAt));

  const slotKey = `${state.slot?.id ?? "none"}:${items.length}`;
  /* Live carousel: rotation must not restart on every render when backend sends
     fresh items array. slotKey includes items.length (slot identity), but not
     the full items array since it's a fresh reference each render.
     biome-ignore lint/correctness/useExhaustiveDependencies: items is fresh each render */
  useEffect(() => {
    if (items.length <= 1) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIndex(0);
      return;
    }
    let timeout: ReturnType<typeof setTimeout>;
    const tick = () => {
      const elapsed = Date.now() - startedAt;
      setIndex(rotationIndexAt(items, elapsed));
      const wait = msUntilNextRotation(items, elapsed);
      timeout = setTimeout(tick, Number.isFinite(wait) ? Math.max(250, wait) : 60_000);
    };
    tick();
    return () => clearTimeout(timeout);
  }, [slotKey, startedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = items[index];
  if (items.length <= 1 || !active) return { mode: state.mode, payload: state.payload };
  return { mode: active.mode, payload: active.payload };
}

/** `activeAnnouncement` derives its pick purely from `Date.now()`, so nothing
 * re-renders the screen when a rotation boundary passes on its own — this
 * forces one on a fixed cadence well below the rotation interval. */
function useAnnouncementRotationTick(): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => clearInterval(id);
  }, []);
}

export function TvDisplay() {
  const { t, language } = useLocale();
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
      const [state, event, rooms, schedule, sponsorResult, announcementResult, venue] =
        await Promise.all([
          getTvState(),
          api.get<PublicEvent>("/api/public/event"),
          getAllRoomViews(),
          logisticsApi.publicSchedule(),
          api.get<{ items: PublicSponsor[] }>("/api/public/sponsors"),
          api.get<{ items: PublicAnnouncement[] }>("/api/announcements/public"),
          getTvVenueConfig(),
        ]);
      // A slower older response must never overwrite the state obtained after
      // an SSE event (for example, a mode change followed by a queue update).
      if (currentRequest !== requestId.current) return;
      setData({
        state,
        event,
        rooms,
        // H50 extension: resolve each item's title/description into the TV's
        // configured language here so ScheduleBlock keeps reading plain
        // item.title/item.description unchanged.
        schedule: schedule.items.map((item) => ({
          ...item,
          ...resolveScheduleText(item, language),
        })),
        sponsors: sponsorResult.items,
        announcements: announcementResult.items,
        venue,
      });
      setError(null);
    } catch {
      if (currentRequest === requestId.current) {
        setError(t("tvReconnecting"));
      }
    }
  }, [t, language]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Dedicated public TV/content streams carry only `data.changed` invalidations.
  // Always refetch sanitized projections rather than deriving screen state from
  // an SSE payload: raw queue events stay on the operational-only channel.
  const refreshPublicProjection = useCallback(() => void load(), [load]);

  useEventSource("/api/tv/stream", {
    events: [EVENTS.DATA_CHANGED],
    onEvent: refreshPublicProjection,
  });
  useEventSource("/api/content/stream", {
    events: [EVENTS.DATA_CHANGED],
    onEvent: refreshPublicProjection,
  });

  return <TvView data={data} error={error} />;
}

/**
 * Split from the data-loading shell so the rotation hook can run against a
 * resolved state without every loading branch having to satisfy the rules of
 * hooks.
 */
function TvView({ data, error }: { data: TvData | null; error: string | null }) {
  const { t } = useLocale();
  const fallbackState: TvState = {
    mode: "rooms",
    payload: null,
    expiresAt: null,
    broadcastAt: null,
    source: "default",
    slot: null,
  };
  const { mode, payload } = useRotatedState(data?.state ?? fallbackState);
  useAnnouncementRotationTick();

  if (!data && !error)
    return (
      <div className="grid min-h-dvh place-items-center" role="status" aria-busy="true">
        <Spinner className="size-10" />
        <span className="sr-only">{t("loadingTvDisplay")}</span>
      </div>
    );
  if (!data)
    return (
      <div className="text-muted-foreground grid min-h-dvh place-items-center p-8 text-center text-2xl">
        {error}
      </div>
    );

  // This is a content layer, not a competing TV mode: it has priority over
  // whatever the timetable is currently showing and disappears at the
  // announcement's own expiry (or when it is deleted).
  const fullscreenAnnouncement = activeAnnouncement(data.announcements, "fullscreen");
  if (fullscreenAnnouncement) {
    return <FullscreenAnnouncement announcement={fullscreenAnnouncement} event={data.event} />;
  }
  const embeddedAnnouncement = activeAnnouncement(data.announcements, "embedded");

  if (mode === "live")
    return (
      <LiveScreen
        config={liveConfigFrom(payload)}
        event={data.event}
        schedule={data.schedule}
        sponsors={data.sponsors}
        venue={data.venue}
        announcement={embeddedAnnouncement}
      />
    );
  if (mode === "schedule")
    return (
      <ScheduleView
        schedule={data.schedule}
        event={data.event}
        announcement={embeddedAnnouncement}
      />
    );
  if (mode === "sponsors")
    return (
      <SponsorsView
        sponsors={data.sponsors}
        event={data.event}
        announcement={embeddedAnnouncement}
      />
    );
  if (mode === "wifi")
    return <WifiView venue={data.venue} event={data.event} announcement={embeddedAnnouncement} />;
  // Legacy announcement/timer values resolve safely to the rooms display until
  // the control/API cleanup removes them from the persisted mode enum.
  return <RoomsView rooms={data.rooms} event={data.event} announcement={embeddedAnnouncement} />;
}
