import * as Haptics from "expo-haptics";

export type HapticIntent = "selection" | "light" | "medium" | "success" | "warning" | "error";

/**
 * H22-H26/H51: tactile feedback is best-effort and must never make an
 * interaction fail when the device or platform has no haptic engine.
 * Expo Haptics goes through UIFeedbackGenerator on iOS and `performHapticFeedback`
 * on Android, so the OS drops the call when System Haptics / touch feedback is
 * off (#1170); nothing here overrides that setting. Scanner and queue outcomes
 * map to intents in `scan-haptics.ts`.
 */
export async function haptic(intent: HapticIntent): Promise<void> {
  if (process.env.EXPO_OS === "web") return;

  try {
    switch (intent) {
      case "selection":
        await Haptics.selectionAsync();
        return;
      case "light":
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return;
      case "medium":
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        return;
      case "success":
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return;
      case "warning":
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      case "error":
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
    }
  } catch {
    // H22-H26/H51: haptics are supplemental; visual and accessibility cues remain primary.
  }
}
