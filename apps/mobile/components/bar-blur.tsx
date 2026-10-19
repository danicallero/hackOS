import { BlurView } from "expo-blur";
import { useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isRealLiquidGlassAvailable } from "@/components/glass-view";

/** Height of the bar row under the status area. */
const BAR_ROW = 56;

/**
 * A blurred band under a transparent header, so content scrolling beneath it fades out instead of
 * running under the bar's title and buttons. Used by Activities, My Projects and Contacts.
 */
export function BarBlur() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  if (!isRealLiquidGlassAvailable()) return null;
  return (
    <BlurView
      pointerEvents="none"
      intensity={40}
      tint={scheme === "dark" ? "systemChromeMaterialDark" : "systemChromeMaterialLight"}
      style={{
        height: insets.top + BAR_ROW,
        left: 0,
        position: "absolute",
        right: 0,
        top: 0,
        zIndex: 5,
      }}
    />
  );
}
