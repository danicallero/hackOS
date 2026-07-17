import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { broadcast } from "../../lib/sse.js";
import { valkey } from "../../lib/valkey.js";

/** H42: TV mode lives in Valkey, not Postgres — it's ephemeral display state. */
const TV_MODE_KEY = "tv:mode";

export interface TvMode {
  mode: "rooms" | "schedule" | "sponsors" | "announcement" | "wifi" | "timer";
  payload: unknown;
  /** ISO timestamp; past this point tv-expiry.ts reverts to the default mode automatically. */
  expiresAt: string | null;
  /** Null only for the untouched default — nothing has ever been broadcast this run. */
  broadcastAt: string | null;
}

const DEFAULT_MODE: TvMode = {
  mode: "rooms",
  payload: null,
  expiresAt: null,
  broadcastAt: null,
};

export async function getTvMode(): Promise<TvMode> {
  const raw = await valkey.get(TV_MODE_KEY);
  if (!raw) return DEFAULT_MODE;
  // Older payloads (pre issue #193) lack expiresAt/broadcastAt — default them.
  return { ...DEFAULT_MODE, ...(JSON.parse(raw) as Partial<TvMode>) };
}

export async function setTvMode(
  mode: TvMode["mode"],
  payload: unknown,
  expiresAt: string | null = null,
): Promise<TvMode> {
  const value: TvMode = {
    mode,
    payload: payload ?? null,
    expiresAt,
    broadcastAt: new Date().toISOString(),
  };
  await valkey.set(TV_MODE_KEY, JSON.stringify(value));
  await broadcast(SSE_TOPICS.TV, EVENTS.TV_MODE_CHANGED, value);
  return value;
}

/** Reverts to the default "rooms" mode without touching payload/expiry state (H42 automatic expiry). */
export async function revertTvModeToDefault(): Promise<TvMode> {
  return setTvMode(DEFAULT_MODE.mode, DEFAULT_MODE.payload, null);
}
