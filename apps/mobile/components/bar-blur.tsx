import { BlurView } from "expo-blur";
import { useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import { useSideRegion } from "@/lib/side-region";

/** Height of the bar row under the status area. */
const BAR_ROW = 56;

/**
 * A blurred band under a transparent header, so content scrolling beneath it fades out like it
 * does under Activities' and My Projects' native bar. Only beside a side column: a vertical bar
 * has no scroll-edge effect of its own, and the top bar there has to be given one. Elsewhere the
 * system already draws it, and a second blur would double it.
 */
export function BarBlur() {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const sideRegion = useSideRegion();
  if (!sideRegion.edge || !isRealLiquidGlassAvailable()) return null;
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
