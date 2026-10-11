package expo.modules.liveupdates

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Debug-only (#966): posts sample Live Updates from adb; see docs/mobile.md
 * "Android Live Updates". Example:
 *
 *   adb shell am broadcast -a expo.modules.liveupdates.DEBUG_SHOW -p com.hackudc.os \
 *     --es id queue:judging --es title "Judging queue" --es chip "#4" --es icon queue
 */
class LiveUpdatesDebugReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra("id") ?: "debug"
    if (intent.action == "expo.modules.liveupdates.DEBUG_DISMISS") {
      LiveUpdatePoster.dismiss(context, id)
      return
    }
    val countdownSeconds = intent.getIntExtra("countdownSeconds", 0)
    val posted = LiveUpdatePoster.show(
      context,
      LiveUpdateContent(
        id = id,
        title = intent.getStringExtra("title") ?: "Live update",
        text = intent.getStringExtra("text"),
        shortCriticalText = intent.getStringExtra("chip"),
        subText = intent.getStringExtra("subText"),
        countdownTo = if (countdownSeconds > 0) System.currentTimeMillis() + countdownSeconds * 1000L else null,
        url = intent.getStringExtra("url") ?: "hackos://",
        actionLabel = intent.getStringExtra("actionLabel"),
        actionUrl = intent.getStringExtra("actionUrl"),
        accentColor = intent.getStringExtra("color"),
        icon = intent.getStringExtra("icon") ?: "activity",
        alert = intent.getBooleanExtra("alert", false),
      ),
    )
    Log.i("LiveUpdates", "debug show id=$id posted=$posted promoted=${LiveUpdatePoster.canPostPromoted(context)}")
  }
}
