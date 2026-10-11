import { NativeModule, requireOptionalNativeModule } from "expo";

/**
 * Android Live Updates (#966): promoted ongoing notifications — the Android 16
 * status-bar chip / lock-screen equivalent of an iOS Live Activity. On older
 * Android versions, or when the user revokes promotion, the same notification
 * renders as a plain ongoing notification. iOS uses `expo-widgets` instead,
 * so this module is Android-only and resolves to `null` elsewhere.
 */
export type LiveUpdateIcon = "queue" | "meal" | "activity";

/** ProgressStyle tracker: a person on a disc in the queue phase's colour. */
export type LiveUpdateTracker = "tracker-waiting" | "tracker-called" | "tracker-in-room";

/**
 * Android 16 `ProgressStyle` track (ignored below API 36, where the text
 * renders as BigText). Segment lengths add up to the track's max; `value` is
 * the filled position on that scale.
 */
export interface LiveUpdateProgress {
  value: number;
  segments: { length: number; color?: string | null }[];
  points?: { position: number; color?: string | null }[];
  /** Icon riding the track at `value`. */
  tracker?: LiveUpdateTracker | null;
}

export interface LiveUpdateSpec {
  /** Stable notification identity, e.g. `queue:judging` or `activity:12`. */
  id: string;
  title: string;
  text?: string | null;
  /** Status-bar chip text (`setShortCriticalText`); keep it to ~7 characters. */
  shortCriticalText?: string | null;
  subText?: string | null;
  /** Epoch ms; renders a chronometer counting down to it (no updates needed). */
  countdownTo?: number | null;
  /** Epoch ms; renders a chronometer counting up from it (e.g. since the call). */
  countUpFrom?: number | null;
  progress?: LiveUpdateProgress | null;
  /** Phase the delete intent records if the person dismisses this post. */
  phase?: string | null;
  /** Deep link opened when the notification is tapped. */
  url: string;
  /** The single action button, opened as a deep link. */
  action?: { label: string; url: string } | null;
  /** `#RRGGBB` accent. */
  accentColor?: string | null;
  icon: LiveUpdateIcon;
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
