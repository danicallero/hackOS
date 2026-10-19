import { NativeModule, requireOptionalNativeModule } from "expo";

/** The fold in window points: a thin rectangle across the display. */
export type DivisionRegion = { x: number; y: number; width: number; height: number };

type FoldRegionEvents = {
  onChange: (event: { region: DivisionRegion | null; barEdge?: "left" | "right" | null }) => void;
};

declare class FoldRegionModule extends NativeModule<FoldRegionEvents> {
  getDivisionRegion(): DivisionRegion | null;
  /** The edge the system puts its vertical bar on (iOS 27.1), whether or not insets report it. */
  getVerticalBarEdge(): "left" | "right" | null;
  /** The Dynamic Island, where the system reports it. */
  getOcclusionRegion(): DivisionRegion | null;
}

/** Missing on Android and on a development client built before the module existed. */
export default requireOptionalNativeModule<FoldRegionModule>("FoldRegion");
