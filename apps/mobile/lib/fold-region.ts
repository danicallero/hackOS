import { useEffect, useState } from "react";
import { Dimensions } from "react-native";

import FoldRegion, { type DivisionRegion } from "@/modules/fold-region";

/** The two areas either side of a horizontal fold, in window points; null when none applies. */
export type FoldPanes = {
  top: { y: number; height: number };
  bottom: { y: number; height: number };
};

/**
 * Splits the window at a fold that runs across it (a "laptop" or "tabletop" pose). A
 * vertical fold (book pose) is not split here: the display is then wider than tall and
 * the side-by-side layout is the system's own two-region layout.
 */
export function foldPanes(region: DivisionRegion | null, windowHeight: number): FoldPanes | null {
  if (!region || region.width <= region.height) return null;
  const topHeight = Math.max(0, region.y);
  const bottomY = region.y + region.height;
  const bottomHeight = Math.max(0, windowHeight - bottomY);
  if (topHeight < 120 || bottomHeight < 120) return null;
  return {
    top: { y: 0, height: topHeight },
    bottom: { y: bottomY, height: bottomHeight },
  };
}

function readRegion(): DivisionRegion | null {
  try {
    return FoldRegion?.getDivisionRegion?.() ?? null;
  } catch {
    return null;
  }
}

/** The fold, re-read when the pose changes (the native module reports it) or the window resizes. */
export function useDivisionRegion(): DivisionRegion | null {
  const [region, setRegion] = useState<DivisionRegion | null>(readRegion);
  useEffect(() => {
    setRegion(readRegion());
    const resize = Dimensions.addEventListener("change", () => setRegion(readRegion()));
    const native = FoldRegion?.addListener?.("onChange", (event) =>
      setRegion(event.region ?? null),
    );
    return () => {
      resize.remove();
      native?.remove();
    };
  }, []);
  return region;
}
