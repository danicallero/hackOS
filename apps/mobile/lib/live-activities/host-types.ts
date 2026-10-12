import type { DesiredActivity, RunningActivity } from "./model";

/**
 * The platform renderer behind the Live Activity orchestration (#966):
 * ActivityKit through `expo-widgets` on iOS, promoted ongoing notifications
 * through `modules/live-updates` on Android, nothing on web.
 */
export interface LiveActivityHost {
  readonly platform: "ios" | "android" | null;
  /** Whether this device can show the surfaces at all (OS version, native module). */
  supported(): boolean;
  running(): RunningActivity[];
  /** Returns the new surface id, or null when the system refused it. */
  start(item: DesiredActivity, previousPhase: string | null): Promise<string | null>;
  update(id: string, item: DesiredActivity, previousPhase: string | null): Promise<void>;
  /** `finished`: the moment passed (iOS keeps it ~15 min); `immediate`: opt-out/sign-out. */
  end(surface: RunningActivity, mode: "finished" | "immediate"): Promise<void>;
  /**
   * Removes surfaces this process ended as `finished` that still show their
   * final state (iOS Lock Screen). `running()` no longer lists them, so
   * sign-out and opt-out would otherwise leave them up to ~15 min.
   */
  dismissEnded(): Promise<void>;
  /**
   * Android only: surfaces the person swiped away since the last call, as
   * key → phase at dismissal, recorded natively from the notification's
   * delete intent; then forgotten. Hosts without it (iOS) infer dismissals
   * from a surface vanishing between reconciles instead.
   */
  consumeDismissals?(): Record<string, string>;
  /**
   * Android only: which rendering a post gets now (`promoted` or `card`).
   * When it changes (the person re-enabled Live updates), every surface is
   * posted again even though its props did not change.
   */
  renderMode?(): string;
  /** iOS per-activity APNs token; Android updates arrive as Expo data pushes instead. */
  pushToken(id: string): Promise<string | null>;
  onPushToken(id: string, listener: (token: string) => void): void;
}
