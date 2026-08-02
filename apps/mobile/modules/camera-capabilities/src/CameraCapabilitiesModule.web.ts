import { NativeModule, registerWebModule } from "expo";

class CameraCapabilitiesModule extends NativeModule<Record<string, never>> {
  hasBackCameraTorch(): boolean {
    return false;
  }
}

export default registerWebModule(CameraCapabilitiesModule, "CameraCapabilities");
