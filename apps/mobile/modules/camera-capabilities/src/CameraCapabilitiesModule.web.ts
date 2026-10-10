import { NativeModule, registerWebModule } from "expo";

class CameraCapabilitiesModule extends NativeModule<Record<string, never>> {
  hasBackCameraTorch(): boolean {
    return false;
  }

  getDisplayCutoutRects(): { left: number; top: number; width: number; height: number }[] {
    return [];
  }
}

export default registerWebModule(CameraCapabilitiesModule, "CameraCapabilities");
