package expo.modules.liveupdates

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject

/**
 * Real user dismissals of Live Updates (#966, H38, H25). The notification's
 * delete intent is the only signal: the system sends it when the person swipes
 * the notification away, never when the app cancels it or when a force-stop,
 * reboot or update removes it. Dismissals are persisted here (id → phase at
 * dismissal) until JS consumes them, so one that happens while no JS runs is
 * not lost.
 */
object LiveUpdateDismissals {
  private const val ACTION = "expo.modules.liveupdates.DISMISSED"
  private const val PREFS = "hackos.live-updates"
  private const val KEY = "dismissals"
  private const val EXTRA_ID = "id"
  private const val EXTRA_PHASE = "phase"

  fun deleteIntent(context: Context, id: String, phase: String?, requestCode: Int): PendingIntent {
    val intent = Intent(context, LiveUpdateDismissReceiver::class.java)
      .setAction(ACTION)
      .putExtra(EXTRA_ID, id)
      .putExtra(EXTRA_PHASE, phase ?: "")
    return PendingIntent.getBroadcast(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  @Synchronized
  fun record(context: Context, intent: Intent) {
    if (intent.action != ACTION) return
    val id = intent.getStringExtra(EXTRA_ID) ?: return
    val all = read(context).put(id, intent.getStringExtra(EXTRA_PHASE) ?: "")
    // commit(): the receiver's process may be killed right after onReceive.
    prefs(context).edit().putString(KEY, all.toString()).commit()
  }

  /** Returns every recorded dismissal (id → phase) and forgets them. */
  @Synchronized
  fun consume(context: Context): Map<String, String> {
    val all = read(context)
    if (all.length() == 0) return emptyMap()
    prefs(context).edit().remove(KEY).commit()
    return all.keys().asSequence().associateWith { all.optString(it) }
  }

  private fun read(context: Context): JSONObject =
    prefs(context).getString(KEY, null)
      ?.let { runCatching { JSONObject(it) }.getOrNull() }
      ?: JSONObject()

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}

class LiveUpdateDismissReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    LiveUpdateDismissals.record(context, intent)
  }
}
