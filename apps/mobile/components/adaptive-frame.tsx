import type { ReactNode } from "react";
import { View } from "react-native";
import { MAX_CONTENT_WIDTH } from "@/lib/window-size";
import { colors } from "@/theme/colors";

/**
 * Keeps the whole navigator to a readable column on wide windows. The tree is
 * the same at every width (only styles change), so folding, unfolding or
 * resizing the window never remounts the navigator or loses its state.
 */
export function AdaptiveFrame({ children }: { children: ReactNode }) {
  return (
    <View style={{ alignItems: "center", backgroundColor: colors.background, flex: 1 }}>
      <View style={{ flex: 1, maxWidth: MAX_CONTENT_WIDTH, width: "100%" }}>{children}</View>
    </View>
  );
}
