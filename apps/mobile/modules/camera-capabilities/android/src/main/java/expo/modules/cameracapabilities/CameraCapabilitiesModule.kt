package expo.modules.cameracapabilities

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CameraCapabilitiesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CameraCapabilities")

    Function("hasBackCameraTorch") {
      val context = appContext.reactContext ?: return@Function false
      val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager

      try {
        cameraManager.cameraIdList.any { cameraId ->
          val characteristics = cameraManager.getCameraCharacteristics(cameraId)
          val isBackCamera =
            characteristics.get(CameraCharacteristics.LENS_FACING) ==
              CameraCharacteristics.LENS_FACING_BACK
          val hasFlash =
            characteristics.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true

          isBackCamera && hasFlash
        }
      } catch (_: Exception) {
        false
      }
    }
  }
}
