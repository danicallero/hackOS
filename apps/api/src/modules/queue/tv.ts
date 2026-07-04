import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { broadcast } from "../../lib/sse.js";
import { valkey } from "../../lib/valkey.js";

/** H42: TV mode lives in Valkey, not Postgres — it's ephemeral display state. */
const TV_MODE_KEY = "tv:mode";

export interface TvMode {
  mode: "rooms" | "schedule" | "sponsors" | "announcement" | "wifi" | "timer";
  payload: unknown;
}

const DEFAULT_MODE: TvMode = { mode: "rooms", payload: null };

export async function getTvMode(): Promise<TvMode> {
  const raw = await valkey.get(TV_MODE_KEY);
  if (!raw) return DEFAULT_MODE;
  return JSON.parse(raw) as TvMode;
}

export async function setTvMode(mode: TvMode["mode"], payload: unknown): Promise<TvMode> {
  const value: TvMode = { mode, payload: payload ?? null };
  await valkey.set(TV_MODE_KEY, JSON.stringify(value));
  await broadcast(SSE_TOPICS.TV, EVENTS.TV_MODE_CHANGED, value);
  return value;
}
