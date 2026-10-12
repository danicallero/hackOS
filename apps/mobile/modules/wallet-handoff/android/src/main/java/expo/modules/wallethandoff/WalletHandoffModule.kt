package expo.modules.wallethandoff

import android.content.ClipData
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class WalletHandoffModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WalletHandoff")

    // H28: one chooser must resolve every MIME alias together. Sequential VIEW
    // launches stop at the first handler and hide wallets accepting another alias.
    AsyncFunction("openPkpass") { contentUri: String, mimeTypes: List<String>, title: String ->
      val uri = Uri.parse(contentUri)
      require(uri.scheme == "content") { "A content URI is required" }
      val activity = appContext.throwingActivity
      val intents = mimeTypes.distinct().map { mimeType ->
        Intent(Intent.ACTION_VIEW).apply {
          setDataAndType(uri, mimeType)
          addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          clipData = ClipData.newRawUri("pkpass", uri)
        }
      }.filter {
        activity.packageManager.queryIntentActivities(it, PackageManager.MATCH_DEFAULT_ONLY).isNotEmpty()
      }
      if (intents.isEmpty()) return@AsyncFunction false
      val chooser = Intent.createChooser(intents.first(), title).apply {
        putExtra(Intent.EXTRA_ALTERNATE_INTENTS, intents.drop(1).toTypedArray())
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        clipData = ClipData.newRawUri("pkpass", uri)
      }
      activity.startActivity(chooser)
      true
    }.runOnQueue(Queues.MAIN)
  }
}
