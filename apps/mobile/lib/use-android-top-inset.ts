import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Headerless top-level tab screens rely on `contentInsetAdjustmentBehavior="automatic"`
 * to sit below the status bar — that prop only does anything on iOS. Expo
 * Router's `NativeTabs` only auto-applies the *bottom* safe-area inset on
 * Android; the top inset is left to the screen, so a headerless screen there
 * renders under the status bar unless padded manually.
 */
export function useAndroidTopInset(): number {
  const insets = useSafeAreaInsets();
  return Platform.OS === "android" ? insets.top : 0;
}
