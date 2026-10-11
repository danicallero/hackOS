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
 *
 * The full states (segmented queue track, meal breakdown) are easier through
 * the JS mapping: `hackos://dev/live-activity?sample=<name>` (dev-samples.ts).
 */
class LiveUpdatesDebugReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra("id") ?: "debug"
    if (intent.action == "expo.modules.liveupdates.DEBUG_DISMISS") {
      LiveUpdatePoster.dismiss(context, id)
      return
    }
    val countdownSeconds = intent.getIntExtra("countdownSeconds", 0)
    val countUpSeconds = intent.getIntExtra("countUpSeconds", 0)
    val progressMax = intent.getIntExtra("progressMax", 0)
    val color = intent.getStringExtra("color")
    val posted = LiveUpdatePoster.show(
      context,
      LiveUpdateContent(
        id = id,
        title = intent.getStringExtra("title") ?: "Live update",
        text = intent.getStringExtra("text"),
        shortCriticalText = intent.getStringExtra("chip"),
        subText = intent.getStringExtra("subText"),
        countdownTo = if (countdownSeconds > 0) System.currentTimeMillis() + countdownSeconds * 1000L else null,
        countUpFrom = if (countUpSeconds > 0) System.currentTimeMillis() - countUpSeconds * 1000L else null,
        // One-segment track; the real multi-segment tracks come from JS.
        progress = if (progressMax > 0) {
          LiveUpdateProgress(
            value = intent.getIntExtra("progress", 0),
            segments = listOf(LiveUpdateSegment(progressMax, color)),
            points = emptyList(),
            tracker = intent.getStringExtra("tracker"),
          )
        } else {
          null
        },
        url = intent.getStringExtra("url") ?: "hackos://",
        actionLabel = intent.getStringExtra("actionLabel"),
        actionUrl = intent.getStringExtra("actionUrl"),
        accentColor = color,
        icon = intent.getStringExtra("icon") ?: "activity",
        alert = intent.getBooleanExtra("alert", false),
        phase = intent.getStringExtra("phase"),
      ),
    )
    Log.i("LiveUpdates", "debug show id=$id posted=$posted promoted=${LiveUpdatePoster.canPostPromoted(context)}")
  }
}
