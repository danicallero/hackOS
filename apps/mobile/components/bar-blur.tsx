import { BlurView } from "expo-blur";
import { useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isRealLiquidGlassAvailable } from "@/components/glass-view";

/** Floor for the band: the bar row of a window whose top inset is small (the Duo reports about 0). */
const MIN_BAND = 60;

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
        height: Math.max(insets.top + 44, MIN_BAND),
        left: 0,
        position: "absolute",
        right: 0,
        top: 0,
        zIndex: 5,
      }}
    />
  );
}
