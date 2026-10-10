import { NativeModule, requireOptionalNativeModule } from "expo";

export type DisplayCutoutRect = { left: number; top: number; width: number; height: number };

declare class CameraCapabilitiesModule extends NativeModule<Record<string, never>> {
  hasBackCameraTorch(): boolean;
  /** Android API 28+: display-cutout bounding rects in dp, window coordinates. */
  getDisplayCutoutRects(): DisplayCutoutRect[];
}

export default requireOptionalNativeModule<CameraCapabilitiesModule>("CameraCapabilities");
