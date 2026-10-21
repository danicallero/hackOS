import { useEffect, useMemo, useState } from "react";
import { Dimensions } from "react-native";

import FoldRegion, { type DivisionRegion } from "@/modules/fold-region";

/** How often the pose is re-read; a hinge move changes neither the window size nor the traits. */
export const POSE_POLL_MS = 400;

export function sameRegion(a: DivisionRegion | null, b: DivisionRegion | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function readRegion(): DivisionRegion | null {
  try {
    return FoldRegion?.getDivisionRegion?.() ?? null;
  } catch {
    return null;
  }
}

/**
 * The fold, re-read when the window resizes, the native module reports a change, and on a short
 * poll: moving the hinge between flat and a laptop pose reaches the app as neither, so without
 * the poll the layout kept the previous pose until the app was relaunched.
 */
export function useDivisionRegion(): DivisionRegion | null {
  const [region, setRegion] = useState<DivisionRegion | null>(readRegion);
  useEffect(() => {
    const refresh = (next: DivisionRegion | null) =>
      setRegion((current) => (sameRegion(current, next) ? current : next));
    refresh(readRegion());
    const resize = Dimensions.addEventListener("change", () => refresh(readRegion()));
    const native = FoldRegion?.addListener?.("onChange", (event) => refresh(event.region ?? null));
    const poll = FoldRegion ? setInterval(() => refresh(readRegion()), POSE_POLL_MS) : null;
    return () => {
      resize.remove();
      native?.remove();
      if (poll) clearInterval(poll);
    };
  }, []);
  return region;
}

/** The crease of a book pose (running top to bottom), in window points; null otherwise. */
export function bookCrease(region: DivisionRegion | null): { x: number; width: number } | null {
  if (!region || region.height <= region.width) return null;
  return { x: region.x, width: region.width };
}

/** The book-pose crease, for screens that put a list and its detail on either page. */
export function useBookCrease(): { x: number; width: number } | null {
  const region = useDivisionRegion();
  return useMemo(() => bookCrease(region), [region]);
}
