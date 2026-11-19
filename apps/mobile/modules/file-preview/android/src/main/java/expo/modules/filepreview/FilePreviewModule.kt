package expo.modules.filepreview

import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * #935, H16: hands a downloaded private file (a CV, a project PDF) to the
 * device's viewer instead of bundling a PDF renderer. Resolves false when no
 * installed app can open the type, so the caller offers Share instead.
 */
class FilePreviewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FilePreview")

    AsyncFunction("open") { contentUri: String, mimeType: String, title: String ->
      val uri = Uri.parse(contentUri)
      require(uri.scheme == "content") { "A content URI is required" }
      val activity = appContext.throwingActivity
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, mimeType)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        clipData = ClipData.newRawUri(title, uri)
      }
      if (activity.packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY).isEmpty()) {
        return@AsyncFunction false
      }
      activity.startActivity(Intent.createChooser(intent, title).apply {
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        clipData = ClipData.newRawUri(title, uri)
      })
      true
    }.runOnQueue(Queues.MAIN)
  }
}
