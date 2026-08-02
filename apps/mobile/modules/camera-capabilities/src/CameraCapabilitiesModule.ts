import { NativeModule, requireOptionalNativeModule } from "expo";

declare class CameraCapabilitiesModule extends NativeModule<Record<string, never>> {
  hasBackCameraTorch(): boolean;
}

export default requireOptionalNativeModule<CameraCapabilitiesModule>("CameraCapabilities");
