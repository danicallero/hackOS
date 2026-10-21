import { useWindowDimensions } from "react-native";
import { useBookCrease } from "@/lib/fold-region";
import { type SideRegion, useSideRegion } from "@/lib/side-region";

/** Narrowest page or window the sign-in form is centred in instead of filling (form + gutters). */
export const AUTH_CENTRED_MIN_WIDTH = 488;
const MIN_PAGE_WIDTH = 320;

/**
 * Extra padding that centres a sign-in form on a foldable. The stack already pads the system's
 * side column on its own edge, so a form centred in what is left sits off the screen's middle.
 * With room to spare the opposite edge gets the same padding (centred on the window); in a book
 * pose the form is centred on the first page instead of straddling the crease.
 */
export function authFrameExtra(
  windowWidth: number,
  region: Pick<SideRegion, "edge" | "size">,
  crease: { x: number; width: number } | null,
): { left: number; right: number } {
  const padLeft = region.edge === "left" ? region.size : 0;
  const padRight = region.edge === "right" ? region.size : 0;
  if (crease && crease.x - padLeft >= MIN_PAGE_WIDTH) {
    return { left: 0, right: Math.max(0, windowWidth - padRight - crease.x) };
  }
  if (region.edge && windowWidth - 2 * region.size >= AUTH_CENTRED_MIN_WIDTH) {
    return region.edge === "right"
      ? { left: region.size, right: 0 }
      : { left: 0, right: region.size };
  }
  return { left: 0, right: 0 };
}

export function useAuthFrameExtra(): { left: number; right: number } {
  const { width } = useWindowDimensions();
  return authFrameExtra(width, useSideRegion(), useBookCrease());
}
