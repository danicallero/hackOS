import AVFoundation
import ExpoModulesCore

public class CameraCapabilitiesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CameraCapabilities")

    Function("hasBackCameraTorch") {
      AVCaptureDevice.default(
        .builtInWideAngleCamera,
        for: .video,
        position: .back
      ).map { device in
        device.hasTorch && device.isTorchModeSupported(.on)
      } ?? false
    }
  }
}
