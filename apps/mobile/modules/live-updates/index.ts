import { NativeModule, requireOptionalNativeModule } from "expo";

/**
 * Android Live Updates (#966): ongoing notifications that mirror an iOS Live
 * Activity. Hybrid, because promotion forbids custom views:
 *
 * - Android 16+ with promotion allowed: a promoted Live Update (status-bar
 *   chip, lock screen) built from `title`/`text`/`subText`, a round
 *   `largeIcon` badge and a `ProgressStyle` track (`progress`).
 * - Everything else (Android 8–15, promotion revoked by the user or OEM): an
 *   ongoing notification with an iOS-like custom card (`card`): large
 *   numbers, the stage track and the Scan button inside the layout.
 *
 * iOS uses `expo-widgets` instead, so this module is Android-only and
 * resolves to `null` elsewhere.
 */

/** Monochrome glyph: the small icon, the badge and the track icons. */
export type LiveUpdateGlyph = "people" | "door" | "queue" | "meal" | "mic" | "star";

/**
 * Colour resolved natively for light and dark: blue, green (go), grey
 * (neutral), and the lighter grey of a track's travelled part.
 */
export type LiveUpdateTone = "accent" | "go" | "neutral" | "travelled";

/**
 * A track like Google Maps' navigation Live Update: the travelled part grey,
 * a round tracker at `value`, the remaining part in each stage's colour with
 * gaps between stages. `ProgressStyle` on the promoted path, a drawn bitmap
 * on the card. Segment lengths are relative; `value` is on their sum.
 */
export interface LiveUpdateProgress {
  value: number;
  segments: { length: number; tone: LiveUpdateTone }[];
  /** Glyph in `trackerTone` on a white disc, riding the track at `value`. */
  tracker?: LiveUpdateGlyph | null;
  trackerTone?: LiveUpdateTone | null;
  /** Destination glyph after the track's end (the room). */
  endGlyph?: LiveUpdateGlyph | null;
  /** Stage boundaries on the same scale; the card labels them (`trackLabels`). */
  stops?: number[] | null;
}

/** A caption over a large value, or over a timer (`countdownTo` / `countUpFrom`). */
export interface LiveUpdateMetric {
  caption?: string | null;
  value?: string | null;
  timer?: "countDown" | "countUp" | null;
  /** Drawn in the phase colour; one per card. */
  hero?: boolean;
  /** A placeholder such as "Estimating…": drawn smaller than a number. */
  quiet?: boolean;
}

/** The custom card (non-promoted path), laid out like the iOS Lock Screen. */
export interface LiveUpdateCard {
  /** Header: challenge or activity name. */
  header: string;
  /** Header trailing text, e.g. "+2 more queues". */
  headerTrailing?: string | null;
  /** Leading large metric. */
  lead: LiveUpdateMetric;
  /** Trailing large metric. */
  trail?: LiveUpdateMetric | null;
  /** Line under the metrics, e.g. the room's location. */
  detail?: string | null;
  /** Equal columns, e.g. Served · Still to eat · Inside. */
  stats?: LiveUpdateMetric[] | null;
  /**
   * Names under `progress.stops`, e.g. In line · Called · In room. The card
   * draws `progress` full width when it has no action, else beside Scan.
   */
  trackLabels?: string[] | null;
  /** Index of the current stop, drawn bold. */
  currentStop?: number | null;
  /** Countdown left of the Scan button, e.g. "Ends in 23:10". */
  footer?: { caption?: string | null; countdownTo: number } | null;
}

export interface LiveUpdateSpec {
  /** Stable notification identity, e.g. `queue:judging` or `activity:12`. */
  id: string;
  /** Promoted path: the hero datum. Also the accessible summary of the card. */
  title: string;
  text?: string | null;
  subText?: string | null;
  /** Leading part of `title` drawn bold (the number), when it survives. */
  emphasis?: string | null;
  /** Status-bar chip text (`setShortCriticalText`); fully shown up to 7 characters. */
  shortCriticalText?: string | null;
  /** Epoch ms; a chronometer counting down to it (no updates needed). */
  countdownTo?: number | null;
  /** Epoch ms; a chronometer counting up from it (e.g. since the call). */
  countUpFrom?: number | null;
  progress?: LiveUpdateProgress | null;
  card?: LiveUpdateCard | null;
  /** Phase the delete intent records if the person dismisses this post. */
  phase?: string | null;
  /** Deep link opened when the notification is tapped. */
  url: string;
  /** The single action (Scan), opened as a deep link. */
  action?: { label: string; url: string } | null;
  tone: LiveUpdateTone;
  icon: LiveUpdateGlyph;
  /** Heads-up + sound for this post (e.g. the team was called); silent otherwise. */
  alert?: boolean;
}

declare class LiveUpdatesModule extends NativeModule<Record<string, never>> {
  /** False below API 26 (no notification channels) — callers skip silently. */
  isSupported(): boolean;
  /** Android 16+: whether the system will promote our notifications to Live Updates. */
  canPostPromotedNotifications(): boolean;
  /** Opens the system screen where the user re-enables promotion. */
  openPromotionSettings(): void;
  /** Creates or updates the notification identified by `spec.id`. */
  show(spec: LiveUpdateSpec): void;
  dismiss(id: string): void;
  /** Ids of the Live Updates currently posted by this app. */
  activeIds(): string[];
  /**
   * Notifications the person swiped away since the last call (id → phase at
   * the time), recorded natively from the delete intent even while no JS
   * runs; then forgotten. App cancels, force-stop and reboot never appear.
   */
  consumeDismissals(): Record<string, string>;
}

export default requireOptionalNativeModule<LiveUpdatesModule>("LiveUpdates");
