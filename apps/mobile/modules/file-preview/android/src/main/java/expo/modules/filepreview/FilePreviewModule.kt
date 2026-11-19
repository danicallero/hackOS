package expo.modules.filepreview

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream

/**
 * #935, H16: renders a downloaded private PDF (a CV, a project file) to page
 * images with the platform's own PdfRenderer, so the app shows it in place
 * without bundling a PDF engine. Pages go to a fresh cache directory the
 * caller deletes when the viewer closes.
 */
class FilePreviewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FilePreview")

    AsyncFunction("renderPdf") { fileUri: String, widthPx: Int ->
      val source = File(requireNotNull(Uri.parse(fileUri).path) { "A file URI is required" })
      val cache = requireNotNull(appContext.reactContext?.cacheDir) { "No cache directory" }
      val directory = File(cache, "pdf-pages-${System.nanoTime()}").apply { mkdirs() }
      val pages = ParcelFileDescriptor.open(source, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
        PdfRenderer(descriptor).use { renderer ->
          (0 until renderer.pageCount).map { index ->
            renderer.openPage(index).use { page ->
              val height = (widthPx.toLong() * page.height / page.width).toInt().coerceAtLeast(1)
              val bitmap = Bitmap.createBitmap(widthPx, height, Bitmap.Config.ARGB_8888)
              bitmap.eraseColor(Color.WHITE)
              page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
              val output = File(directory, "page-$index.jpg")
              FileOutputStream(output).use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }
              bitmap.recycle()
              mapOf("uri" to Uri.fromFile(output).toString(), "width" to widthPx, "height" to height)
            }
          }
        }
      }
      mapOf("directory" to Uri.fromFile(directory).toString(), "pages" to pages)
    }
  }
}
