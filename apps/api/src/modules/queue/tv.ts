import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { pool } from "../../db/pool.js";
import { broadcast } from "../../lib/sse.js";
import { valkey } from "../../lib/valkey.js";

/**
 * H42: what the venue's screens are showing. Two layers:
 *
 *  - the **timetable** (`tv_slots`, migration 0403) — absolute time windows in
 *    Postgres saying what to show when, so the fleet follows the event without
 *    anyone at the control page;
 *  - the **override** — one operator broadcast, ephemeral display state, so it
 *    stays in Valkey exactly as it always has.
 *
 * `resolveTvState()` composes them. Nothing else in the codebase should read
 * either layer directly.
 */
const TV_MODE_KEY = "tv:mode";
/** Last state the scheduler actually published, so a tick only broadcasts on change. */
const TV_EFFECTIVE_KEY = "tv:effective";

export type TvModeName = "rooms" | "schedule" | "sponsors" | "wifi" | "live";

/** One operator broadcast. Wins over the timetable until cleared or expired. */
export interface TvMode {
  mode: TvModeName;
  payload: unknown;
  /** ISO timestamp; past this point tv-scheduler.ts drops the override automatically. */
  expiresAt: string | null;
  /** Null only for the untouched default — nothing has ever been broadcast this run. */
  broadcastAt: string | null;
}

/** One thing a slot shows. `seconds` only matters when a slot has several. */
export interface TvSlotItem {
  mode: TvModeName;
  payload: unknown;
  seconds: number | null;
}

export interface TvSlot {
  id: number;
  label: string | null;
  startsAt: string;
  endsAt: string;
  items: TvSlotItem[];
}

/** What the screens should be showing right now, and why. */
export interface TvState extends TvMode {
  source: "override" | "slot" | "default";
  /** Present when source === "slot"; `items` drives client-side rotation. */
  slot: TvSlot | null;
}

const TV_MODE_NAMES: readonly TvModeName[] = ["rooms", "schedule", "sponsors", "wifi", "live"];

/** Older Valkey overrides may survive a deploy. Timer safely becomes live;
 * retired announcement overrides are ignored so they cannot strand the wall
 * on a mode the display no longer renders. */
function normalizeLegacyTvMode(mode: unknown): TvModeName | null {
  if (mode === "timer") return "live";
  return TV_MODE_NAMES.includes(mode as TvModeName) ? (mode as TvModeName) : null;
}

const DEFAULT_MODE: TvMode = {
  mode: "rooms",
  payload: null,
  expiresAt: null,
  broadcastAt: null,
};

/** The raw override layer, with no timetable applied. */
export async function getTvOverride(): Promise<TvMode | null> {
  const raw = await valkey.get(TV_MODE_KEY);
  if (!raw) return null;
  // Older payloads (pre issue #193) lack expiresAt/broadcastAt — default them.
  const parsed = JSON.parse(raw) as Partial<TvMode>;
  const mode = normalizeLegacyTvMode(parsed.mode);
  if (!mode) return null;
  return { ...DEFAULT_MODE, ...parsed, mode };
}

function overrideIsLive(override: TvMode | null, now: number): override is TvMode {
  if (!override) return false;
  return !override.expiresAt || new Date(override.expiresAt).getTime() > now;
}

export function rowToSlot(row: Record<string, unknown>): TvSlot {
  return {
    id: Number(row.id),
    label: (row.label as string | null) ?? null,
    startsAt: (row.starts_at as Date).toISOString(),
    endsAt: (row.ends_at as Date).toISOString(),
    items: row.items as TvSlotItem[],
  };
}

/**
 * The slot covering `now`. Slots may overlap; the latest-starting one wins, so
 * a short window (an opening ceremony) beats the all-day one it sits inside.
 */
export async function currentTvSlot(at: Date = new Date()): Promise<TvSlot | null> {
  const { rows } = await pool.query(
    `SELECT id, label, starts_at, ends_at, items
       FROM tv_slots
      WHERE starts_at <= $1 AND ends_at > $1
      ORDER BY starts_at DESC, id DESC
      LIMIT 1`,
    [at],
  );
  return rows[0] ? rowToSlot(rows[0]) : null;
}

export async function listTvSlots(): Promise<TvSlot[]> {
  const { rows } = await pool.query(
    `SELECT id, label, starts_at, ends_at, items FROM tv_slots ORDER BY starts_at ASC, id ASC`,
  );
  return rows.map(rowToSlot);
}

export interface TvVenueConfig {
  wifi: { ssid: string; password: string | null } | null;
}

/**
 * Venue details the screens render regardless of mode (H42). Kept off
 * /api/public/event on purpose: that feed backs the public website, whereas
 * this one exists for the screens standing in the venue.
 */
export async function tvVenueConfig(): Promise<TvVenueConfig> {
  const { rows } = await pool.query(
    `SELECT wifi_ssid, wifi_password FROM event_config WHERE id = 1`,
  );
  const row = rows[0];
  const ssid = (row?.wifi_ssid as string | null) ?? null;
  if (!ssid) return { wifi: null };
  return { wifi: { ssid, password: (row.wifi_password as string | null) || null } };
}

/** Override → covering slot → default. */
export async function resolveTvState(at: Date = new Date()): Promise<TvState> {
  const override = await getTvOverride();
  if (overrideIsLive(override, at.getTime())) {
    return { ...override, source: "override", slot: null };
  }

  const slot = await currentTvSlot(at);
  // A slot always has at least one item (CHECK in 0403); an empty one would
  // mean hand-edited data, and falling through to the default beats a blank
  // screen in the venue.
  const first = slot?.items[0];
  if (slot && first) {
    return {
      mode: first.mode,
      payload: first.payload ?? null,
      expiresAt: null,
      // The slot's own start is when this became what the screens show.
      broadcastAt: slot.startsAt,
      source: "slot",
      slot,
    };
  }

  return { ...DEFAULT_MODE, source: "default", slot: null };
}

export async function setTvMode(
  mode: TvModeName,
  payload: unknown,
  expiresAt: string | null = null,
): Promise<TvState> {
  const value: TvMode = {
    mode,
    payload: payload ?? null,
    expiresAt,
    broadcastAt: new Date().toISOString(),
  };
  await valkey.set(TV_MODE_KEY, JSON.stringify(value));
  return publishTvState();
}

/**
 * Drops the operator override so the timetable takes back over ("back to
 * schedule"). With no slot covering now this lands on the default mode, which
 * is the same place the old revert-to-rooms behaviour ended up.
 */
export async function clearTvOverride(): Promise<TvState> {
  await valkey.del(TV_MODE_KEY);
  return publishTvState();
}

/** Resolves the current state and broadcasts it to the fleet unconditionally. */
export async function publishTvState(): Promise<TvState> {
  const state = await resolveTvState();
  await valkey.set(TV_EFFECTIVE_KEY, stateFingerprint(state));
  await broadcast(SSE_TOPICS.TV, EVENTS.TV_MODE_CHANGED, state);
  return state;
}

/**
 * What the screens actually render, so a scheduler tick can tell "nothing
 * changed" from "a slot boundary just passed". Deliberately excludes
 * broadcastAt-style bookkeeping that doesn't alter the picture.
 */
function stateFingerprint(state: TvState): string {
  return JSON.stringify({
    source: state.source,
    mode: state.mode,
    payload: state.payload,
    slotId: state.slot?.id ?? null,
    slotItems: state.slot?.items ?? null,
  });
}

/** Broadcasts only if what the screens should show has actually changed. */
export async function publishTvStateIfChanged(): Promise<{ changed: boolean; state: TvState }> {
  const state = await resolveTvState();
  const fingerprint = stateFingerprint(state);
  const previous = await valkey.get(TV_EFFECTIVE_KEY);
  if (previous === fingerprint) return { changed: false, state };
  await valkey.set(TV_EFFECTIVE_KEY, fingerprint);
  await broadcast(SSE_TOPICS.TV, EVENTS.TV_MODE_CHANGED, state);
  return { changed: true, state };
}
