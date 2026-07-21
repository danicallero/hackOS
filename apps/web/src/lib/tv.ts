import type { PublicEvent } from "@/components/public/public-types";
import { api } from "@/lib/api";

/**
 * TV display model (H41/H42): what the venue screens show, the timetable that
 * drives it, and the pure logic the screens run on (rotation, which part of
 * the agenda is "upcoming", what the countdown counts to). Kept out of the
 * components so the state machines are unit-tested rather than eyeballed on a
 * projector.
 */

export type TvModeName =
  | "rooms"
  | "schedule"
  | "sponsors"
  | "announcement"
  | "wifi"
  | "timer"
  | "live";

export interface TvSlotItem {
  mode: TvModeName;
  payload: unknown;
  /** Dwell time when a slot rotates; null falls back to DEFAULT_ROTATION_SECONDS. */
  seconds: number | null;
}

export interface TvSlot {
  id: number;
  label: string | null;
  startsAt: string;
  endsAt: string;
  items: TvSlotItem[];
}

/** The resolved state of the fleet: what to show, and why. */
export interface TvState {
  mode: TvModeName;
  payload: unknown;
  expiresAt: string | null;
  broadcastAt: string | null;
  source: "override" | "slot" | "default";
  slot: TvSlot | null;
}

export interface TvVenueConfig {
  wifi: { ssid: string; password: string | null } | null;
}

// ── api ──────────────────────────────────────────────────────────────────
export const getTvState = () => api.get<TvState>("/api/tv/mode");
export const setTvMode = (
  mode: TvModeName,
  payload: unknown = null,
  expiresAt: string | null = null,
) => api.patch<TvState>("/api/tv/mode", { mode, payload, expiresAt });
/** "Back to schedule": drops the override so the timetable takes over again. */
export const clearTvOverride = () => api.delete<TvState>("/api/tv/mode");
export const getTvVenueConfig = () => api.get<TvVenueConfig>("/api/tv/config");

export interface TvSlotInput {
  label?: string | null;
  startsAt: string;
  endsAt: string;
  items: Array<{ mode: TvModeName; payload?: unknown; seconds?: number | null }>;
}
export const listTvSlots = () => api.get<{ items: TvSlot[] }>("/api/tv/slots");
export const createTvSlot = (body: TvSlotInput) => api.post<TvSlot>("/api/tv/slots", { ...body });
export const updateTvSlot = (id: number, body: Partial<TvSlotInput>) =>
  api.patch<TvSlot>(`/api/tv/slots/${id}`, { ...body });
export const deleteTvSlot = (id: number) => api.delete<{ ok: true }>(`/api/tv/slots/${id}`);

// ── live screen configuration ────────────────────────────────────────────

/** What the countdown counts to. "auto" reuses the public site's phase logic. */
export type TimerTarget =
  | "auto"
  | "hackingStartsAt"
  | "hackingEndsAt"
  | "judgingStartsAt"
  | "judgingEndsAt"
  | "custom";

export const TIMER_TARGETS: TimerTarget[] = [
  "auto",
  "hackingStartsAt",
  "hackingEndsAt",
  "judgingStartsAt",
  "judgingEndsAt",
  "custom",
];

export interface LiveScreenConfig {
  timer: { show: boolean; target: TimerTarget; label: string | null; endsAt: string | null };
  schedule: { show: boolean; upcoming: number };
  sponsors: { show: boolean };
  wifi: { show: boolean; showPassword: boolean; showQr: boolean };
}

export const DEFAULT_LIVE_CONFIG: LiveScreenConfig = {
  timer: { show: true, target: "auto", label: null, endsAt: null },
  schedule: { show: true, upcoming: 6 },
  sponsors: { show: true },
  wifi: { show: true, showPassword: true, showQr: true },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * A broadcast payload is `unknown` by the time it reaches a screen — it may
 * come from an operator broadcast, a timetable slot, or an older version of
 * either. Every block falls back to its default rather than disappearing, so
 * a malformed payload never leaves a blank wall.
 */
export function liveConfigFrom(payload: unknown): LiveScreenConfig {
  if (!isRecord(payload)) return DEFAULT_LIVE_CONFIG;
  const timer = isRecord(payload.timer) ? payload.timer : {};
  const schedule = isRecord(payload.schedule) ? payload.schedule : {};
  const sponsors = isRecord(payload.sponsors) ? payload.sponsors : {};
  const wifi = isRecord(payload.wifi) ? payload.wifi : {};
  const target = TIMER_TARGETS.includes(timer.target as TimerTarget)
    ? (timer.target as TimerTarget)
    : DEFAULT_LIVE_CONFIG.timer.target;
  const upcoming = Number(schedule.upcoming);
  return {
    timer: {
      show: bool(timer.show, DEFAULT_LIVE_CONFIG.timer.show),
      target,
      label: text(timer.label),
      endsAt: text(timer.endsAt),
    },
    schedule: {
      show: bool(schedule.show, DEFAULT_LIVE_CONFIG.schedule.show),
      upcoming:
        Number.isFinite(upcoming) && upcoming > 0
          ? Math.min(20, Math.floor(upcoming))
          : DEFAULT_LIVE_CONFIG.schedule.upcoming,
    },
    sponsors: { show: bool(sponsors.show, DEFAULT_LIVE_CONFIG.sponsors.show) },
    wifi: {
      show: bool(wifi.show, DEFAULT_LIVE_CONFIG.wifi.show),
      showPassword: bool(wifi.showPassword, DEFAULT_LIVE_CONFIG.wifi.showPassword),
      showQr: bool(wifi.showQr, DEFAULT_LIVE_CONFIG.wifi.showQr),
    },
  };
}

export type ResolvedTimer =
  /** Defer to the shared hacking/judging phase logic (components/public/timer.tsx). */
  { kind: "phase" } | { kind: "fixed"; endsAt: string; label: string | null };

/**
 * A configured target that has no date set (judging window never filled in, a
 * custom timer with no datetime) falls back to the phase logic rather than
 * rendering a dead "--:--:--".
 */
export function resolveTimer(config: LiveScreenConfig, event: PublicEvent | null): ResolvedTimer {
  const { target, label, endsAt } = config.timer;
  if (target === "auto") return { kind: "phase" };
  const value = target === "custom" ? endsAt : (event?.[target] ?? null);
  if (!value) return { kind: "phase" };
  return { kind: "fixed", endsAt: value, label };
}

// ── rotation ─────────────────────────────────────────────────────────────

export const DEFAULT_ROTATION_SECONDS = 30;

const dwellMs = (item: TvSlotItem) => Math.max(1, item.seconds ?? DEFAULT_ROTATION_SECONDS) * 1000;

/**
 * Which entry of a rotating slot is on screen `elapsedMs` into the slot.
 * Driven off the slot's own start rather than page load, so every screen in
 * the venue flips at the same moment even if they were switched on hours
 * apart.
 */
export function rotationIndexAt(items: TvSlotItem[], elapsedMs: number): number {
  if (items.length <= 1) return 0;
  const cycle = items.reduce((total, item) => total + dwellMs(item), 0);
  if (cycle <= 0) return 0;
  // A screen opened before the slot began sits on the first entry.
  let offset = elapsedMs <= 0 ? 0 : elapsedMs % cycle;
  for (let index = 0; index < items.length; index += 1) {
    offset -= dwellMs(items[index]);
    if (offset < 0) return index;
  }
  return items.length - 1;
}

/** Milliseconds until the rotation moves on, for scheduling the next flip. */
export function msUntilNextRotation(items: TvSlotItem[], elapsedMs: number): number {
  if (items.length <= 1) return Number.POSITIVE_INFINITY;
  const cycle = items.reduce((total, item) => total + dwellMs(item), 0);
  let offset = elapsedMs <= 0 ? 0 : elapsedMs % cycle;
  if (elapsedMs < 0) return -elapsedMs;
  for (const item of items) {
    offset -= dwellMs(item);
    if (offset < 0) return -offset;
  }
  return cycle;
}

// ── schedule window ──────────────────────────────────────────────────────

export interface ScheduleWindowItem {
  id: number;
  startsAt: string;
  endsAt: string;
}

export interface ScheduleWindow<T> {
  /** The whole agenda in chronological order — the screen renders it and scrolls. */
  ordered: T[];
  /**
   * Row to scroll to the top of the visible block. Clamped so the last page
   * stays full instead of the block emptying out as the day ends.
   */
  startIndex: number;
  /** Index (within `ordered`) of the first activity that hasn't finished; -1 once the day is over. */
  firstUpcomingIndex: number;
}

/**
 * Where the agenda block should be parked: on the first activity that hasn't
 * finished, so what's happening now and next is always in view without anyone
 * scrolling (H42). Whatever is currently running stays visible rather than
 * scrolling away the moment it starts.
 */
export function upcomingWindow<T extends ScheduleWindowItem>(
  items: T[],
  now: number,
  visible: number,
): ScheduleWindow<T> {
  const ordered = [...items].sort(
    (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime(),
  );
  if (ordered.length === 0 || visible <= 0) {
    return { ordered, startIndex: 0, firstUpcomingIndex: -1 };
  }
  const firstUpcoming = ordered.findIndex((item) => new Date(item.endsAt).getTime() > now);
  // Never scroll past the point where the block would show blank rows.
  const lastUsefulStart = Math.max(0, ordered.length - visible);
  const startIndex =
    firstUpcoming === -1 ? lastUsefulStart : Math.min(firstUpcoming, lastUsefulStart);
  return { ordered, startIndex, firstUpcomingIndex: firstUpcoming };
}

// ── sponsor grid ─────────────────────────────────────────────────────────

/** Logo-shaped tiles: wide rectangles, never stretched to fill a column. */
export const SPONSOR_TILE_ASPECT = 3 / 2;

/**
 * The fewest columns whose rows still fit the block — fewest columns means the
 * widest tile, and since tiles keep a logo aspect ratio, the widest tile is the
 * biggest logo. Never one column (that wastes the block's width and looks like
 * a mistake), never more columns than there are sponsors.
 *
 * Falls back to the most columns allowed when nothing fits: at that point the
 * grid is overflowing whatever we choose, and smaller tiles overflow least.
 */
export function bestSponsorColumns(opts: {
  count: number;
  width: number;
  height: number;
  gap: number;
  maxColumns: number;
}): number {
  const { count, width, height, gap, maxColumns } = opts;
  const cap = Math.max(2, Math.min(maxColumns, count));
  if (count === 0 || width <= 0 || height <= 0) return Math.min(2, cap);
  for (let columns = 2; columns <= cap; columns += 1) {
    const tileWidth = (width - gap * (columns - 1)) / columns;
    const tileHeight = tileWidth / SPONSOR_TILE_ASPECT;
    const rows = Math.ceil(count / columns);
    if (rows * tileHeight + gap * (rows - 1) <= height) return columns;
  }
  return cap;
}

// ── Wi-Fi join code ──────────────────────────────────────────────────────

/**
 * The `WIFI:` payload phone cameras understand as "join this network", so a
 * participant points at the screen instead of typing a password off a wall
 * (H42). Rendered locally, never through a QR web service: the screens may
 * have no internet, and the venue password is not something to hand to a
 * third party.
 *
 * Security type is inferred rather than configured — a network with a
 * password is WPA in every venue we serve, and one without is open.
 */
export function wifiJoinCode(wifi: { ssid: string; password: string | null }): string {
  // Order matters to some scanners: T (type) before S (ssid) before P.
  const quote = (value: string) => value.replace(/([\\;,:"])/g, "\\$1");
  const type = wifi.password ? "WPA" : "nopass";
  const password = wifi.password ? `P:${quote(wifi.password)};` : "";
  return `WIFI:T:${type};S:${quote(wifi.ssid)};${password};`;
}
