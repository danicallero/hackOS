import { BlurView } from "expo-blur";
import { useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import { SCREEN_TITLE_CENTER } from "@/theme/screen-title";

/** Below the title's centre line: the band runs to just under the bar row, not into the content. */
const BELOW_TITLE = 36;

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
        // Title centre + a little (the Duo reports a small top inset); phones add their notch.
        height: Math.max(insets.top + 44, SCREEN_TITLE_CENTER + BELOW_TITLE),
        left: 0,
        position: "absolute",
        right: 0,
        top: 0,
        zIndex: 5,
      }}
    />
  );
}
