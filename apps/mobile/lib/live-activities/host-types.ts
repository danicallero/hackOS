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
  /** iOS per-activity APNs token; Android updates arrive as Expo data pushes instead. */
  pushToken(id: string): Promise<string | null>;
  onPushToken(id: string, listener: (token: string) => void): void;
}
