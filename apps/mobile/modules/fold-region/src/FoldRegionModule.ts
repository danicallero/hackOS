import { NativeModule, requireOptionalNativeModule } from "expo";

/** The fold in window points: a thin rectangle across the display. */
export type DivisionRegion = { x: number; y: number; width: number; height: number };

type FoldRegionEvents = { onChange: (event: { region: DivisionRegion | null }) => void };

declare class FoldRegionModule extends NativeModule<FoldRegionEvents> {
  getDivisionRegion(): DivisionRegion | null;
}

/** Missing on Android and on a development client built before the module existed. */
export default requireOptionalNativeModule<FoldRegionModule>("FoldRegion");
