import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Headerless top-level tab screens rely on `contentInsetAdjustmentBehavior="automatic"`
 * to sit below the status bar — that prop only does anything on iOS. The
 * custom tab shell owns the bottom inset on both platforms; Android still
 * needs this top inset because the screen itself has no native header.
 */
export function useAndroidTopInset(): number {
  const insets = useSafeAreaInsets();
  return Platform.OS === "android" ? insets.top : 0;
}
