import { NativeModule, requireOptionalNativeModule } from "expo";

/**
 * Android Live Updates (#966): promoted ongoing notifications — the Android 16
 * status-bar chip / lock-screen equivalent of an iOS Live Activity. On older
 * Android versions, or when the user revokes promotion, the same notification
 * renders as a plain ongoing notification. iOS uses `expo-widgets` instead,
 * so this module is Android-only and resolves to `null` elsewhere.
 */
export type LiveUpdateIcon = "queue" | "meal" | "activity";

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
}

export default requireOptionalNativeModule<LiveUpdatesModule>("LiveUpdates");
