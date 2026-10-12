package expo.modules.cameracapabilities

import android.content.Context
import android.graphics.Rect
import android.graphics.Region
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Build
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

    // DisplayCutout rects in dp (window coordinates), tightened to the cutout
    // shape on API 31+. Empty below API 28, without a cutout, or before the
    // window is attached.
    Function("getDisplayCutoutRects") {
      val none = emptyList<Map<String, Double>>()
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return@Function none
      try {
        val activity = appContext.currentActivity ?: return@Function none
        val insets = activity.window.decorView.rootWindowInsets ?: return@Function none
        val cutout = insets.displayCutout ?: return@Function none
        val density = activity.resources.displayMetrics.density.toDouble()
        // Android 12+: OEMs often pad bounding rects (some up to the status
        // bar), so size each one to the actual cutout shape inside it. The
        // morph then lands on the real hole punch.
        val path = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) cutout.cutoutPath else null
        cutout.boundingRects.map { bounding ->
          var rect = bounding
          if (path != null && !path.isEmpty) {
            val shape = Region()
            if (shape.setPath(path, Region(bounding)) && !shape.isEmpty) rect = Rect(shape.bounds)
          }
          mapOf(
            "left" to rect.left / density,
            "top" to rect.top / density,
            "width" to rect.width() / density,
            "height" to rect.height() / density,
          )
        }
      } catch (_: Exception) {
        none
      }
    }
  }
}
