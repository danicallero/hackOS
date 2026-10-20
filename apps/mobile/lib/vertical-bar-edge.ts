import { useEffect, useState } from "react";
import { Dimensions, Platform, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { POSE_POLL_MS } from "@/lib/fold-region";
import { navigationSideInsets } from "@/lib/side-region";
import FoldRegion from "@/modules/fold-region";

function readEdge(): "left" | "right" | null {
  try {
    return FoldRegion?.getVerticalBarEdge?.() ?? null;
  } catch {
    return null;
  }
}

/** The edge the system puts its vertical bar on, re-read when the pose or window changes (a hinge move is polled). */
export function useVerticalBarEdge(): "left" | "right" | null {
  const [edge, setEdge] = useState(readEdge);
  useEffect(() => {
    setEdge(readEdge());
    const resize = Dimensions.addEventListener("change", () => setEdge(readEdge()));
    const native = FoldRegion?.addListener?.("onChange", (event) =>
      setEdge(event.barEdge ?? readEdge()),
    );
    const poll = FoldRegion ? setInterval(() => setEdge(readEdge()), POSE_POLL_MS) : null;
    return () => {
      resize.remove();
      native?.remove();
      if (poll) clearInterval(poll);
    };
  }, []);
  return edge;
}

/** Safe-area insets plus the vertical-bar column the insets do not report. Root-level use only. */
export function useSideInsets(): { left: number; right: number } {
  const insets = useSafeAreaInsets();
  const edge = useVerticalBarEdge();
  const window = useWindowDimensions();
  return navigationSideInsets(insets, edge, window, Platform.OS);
}
