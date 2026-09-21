import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { broadcast } from "../../lib/sse.js";
import { valkey } from "../../lib/valkey.js";

/**
 * H42: what the venue's screens are showing. An operator selects one mode for
 * the whole fleet; the selection stays in Valkey and can be reset to rooms.
 */
const TV_MODE_KEY = "tv:mode";

export type TvModeName = "rooms" | "schedule" | "sponsors" | "wifi" | "live";

/** One operator-selected display mode. */
export interface TvMode {
  mode: TvModeName;
  payload: unknown;
  /** Null only for the default rooms display, before an operator selects a mode. */
  broadcastAt: string | null;
}

/** What the screens should be showing right now, and why. */
export interface TvState extends TvMode {
  source: "manual" | "default";
}

const TV_MODE_NAMES: readonly TvModeName[] = ["rooms", "schedule", "sponsors", "wifi", "live"];

function isTvModeName(value: unknown): value is TvModeName {
  return TV_MODE_NAMES.includes(value as TvModeName);
}

/** Valkey is disposable, so stale or malformed selections are discarded rather
 * than translated into a current mode. */
function isTvOverride(value: unknown): value is TvMode {
  if (!value || typeof value !== "object") return false;
  const override = value as Record<string, unknown>;
  return (
    isTvModeName(override.mode) && "payload" in override && typeof override.broadcastAt === "string"
  );
}

const DEFAULT_MODE: TvMode = {
  mode: "rooms",
  payload: null,
  broadcastAt: null,
};

/** The raw manually selected mode. */
export async function getTvMode(): Promise<TvMode | null> {
  try {
    const raw = await valkey.get(TV_MODE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isTvOverride(parsed)) return parsed;

    await valkey.del(TV_MODE_KEY);
    return null;
  } catch (err) {
    // The selection is ephemeral. A broker outage must not block the public TV
    // read; continue with the default rooms projection (#535).
    console.warn("[tv] Valkey mode unavailable; using default rooms", err);
    return null;
  }
}

export type TvLanguage = "es" | "gl" | "en";

export interface TvVenueConfig {
  wifi: { ssid: string; password: string | null } | null;
  /** Operator-chosen language every screen renders in; null follows the default. */
  language: TvLanguage | null;
}

function toTvLanguage(value: unknown): TvLanguage | null {
  return value === "es" || value === "gl" || value === "en" ? value : null;
}

/**
 * Venue details the screens render regardless of mode (H42). Kept off
 * /api/public/event on purpose: that feed backs the public website, whereas
 * this one exists for the screens standing in the venue.
 */
export async function tvVenueConfig(): Promise<TvVenueConfig> {
  const { rows } = await pool.query(
    `SELECT wifi_ssid, wifi_password, tv_language FROM event_config WHERE id = 1`,
  );
  const row = rows[0];
  const ssid = (row?.wifi_ssid as string | null) ?? null;
  return {
    wifi: ssid ? { ssid, password: (row.wifi_password as string | null) || null } : null,
    language: toTvLanguage(row?.tv_language),
  };
}

/**
 * The wall's language is an operator setting, not a signed-in caller's own
 * preference — a staff session cookie in the kiosk browser must never change
 * what a public screen shows. Persisted so it survives control-page reloads
 * even when nobody is at the control page.
 */
export async function setTvLanguage(
  language: TvLanguage | null,
  actorId: number | null,
): Promise<TvVenueConfig> {
  const config = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO event_config (id, tv_language) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET tv_language = EXCLUDED.tv_language
       RETURNING wifi_ssid, wifi_password, tv_language`,
      [language],
    );
    const row = rows[0];
    const next: TvVenueConfig = {
      wifi: row?.wifi_ssid ? { ssid: row.wifi_ssid, password: row.wifi_password || null } : null,
      language: toTvLanguage(row?.tv_language),
    };
    await audit(client, {
      actorId,
      entityType: "event_config",
      entityId: 1,
      action: "update",
      after: { tvLanguage: next.language },
    });
    return next;
  });
  await broadcast(SSE_TOPICS.TV, EVENTS.TV_CONFIG_CHANGED, {});
  return config;
}

/** Manual selection → default rooms. */
export async function resolveTvState(): Promise<TvState> {
  const selected = await getTvMode();
  if (selected) return { ...selected, source: "manual" };
  return { ...DEFAULT_MODE, source: "default" };
}

export async function setTvMode(mode: TvModeName, payload: unknown): Promise<TvState> {
  const value: TvMode = {
    mode,
    payload: payload ?? null,
    broadcastAt: new Date().toISOString(),
  };
  await valkey.set(TV_MODE_KEY, JSON.stringify(value));
  return publishTvState();
}

/** Clears the operator's selection and restores the default rooms display. */
export async function clearTvMode(): Promise<TvState> {
  await valkey.del(TV_MODE_KEY);
  return publishTvState();
}

/** Resolves the current state and broadcasts it to the fleet unconditionally. */
export async function publishTvState(): Promise<TvState> {
  const state = await resolveTvState();
  await broadcast(SSE_TOPICS.TV, EVENTS.TV_MODE_CHANGED, state);
  return state;
}
