package expo.modules.liveupdates

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.graphics.drawable.IconCompat

/** One coloured stretch of a ProgressStyle track; lengths add up to the track's max. */
data class LiveUpdateSegment(val length: Int, val color: String?)

/** A marker on the track, e.g. a stage boundary. */
data class LiveUpdatePoint(val position: Int, val color: String?)

data class LiveUpdateProgress(
  val value: Int,
  val segments: List<LiveUpdateSegment>,
  val points: List<LiveUpdatePoint>,
  /** Icon riding the track at `value` (e.g. `tracker-waiting`), or null for none. */
  val tracker: String?,
)

/** Platform-neutral copy of the JS `LiveUpdateSpec` (#966). */
data class LiveUpdateContent(
  val id: String,
  val title: String,
  val text: String?,
  val shortCriticalText: String?,
  val subText: String?,
  val countdownTo: Long?,
  val countUpFrom: Long? = null,
  val progress: LiveUpdateProgress? = null,
  val url: String,
  val actionLabel: String?,
  val actionUrl: String?,
  val accentColor: String?,
  val icon: String,
  val alert: Boolean,
  /** Recorded by the delete intent when the person dismisses this post. */
  val phase: String? = null,
)

/**
 * Posts Android Live Updates (#966, H38, H25, H26): promoted ongoing
 * notifications. Android 16+ shows them as a status-bar chip and on the lock
 * screen with a ProgressStyle track; older versions, or users who revoked
 * promotion, get the same content as a plain ongoing BigText notification.
 */
object LiveUpdatePoster {
  const val TAG_PREFIX = "hackos.live-update:"
  private const val ROUTINE_CHANNEL = "hackos_live_updates"
  private const val ALERT_CHANNEL = "hackos_live_updates_alert"
  private const val BAKLAVA = 36

  fun isSupported(): Boolean = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O

  fun canPostPromoted(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < BAKLAVA) return false
    return manager(context).canPostPromotedNotifications()
  }

  /** Returns false (posting nothing) when unsupported or notifications are blocked. */
  fun show(context: Context, content: LiveUpdateContent): Boolean {
    if (!isSupported()) return false
    val manager = manager(context)
    // expo-notifications owns the POST_NOTIFICATIONS prompt; without it, no-op.
    if (!manager.areNotificationsEnabled()) return false
    ensureChannels(context, manager)

    val channel = if (content.alert) ALERT_CHANNEL else ROUTINE_CHANNEL
    val builder = NotificationCompat.Builder(context, channel)
      .setSmallIcon(iconRes(content.icon))
      .setContentTitle(content.title)
      .setOngoing(true)
      .setRequestPromotedOngoing(true)
      .setOnlyAlertOnce(!content.alert)
      .setCategory(NotificationCompat.CATEGORY_STATUS)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setContentIntent(viewIntent(context, content.url, requestCode(content.id, 0)))
      .setDeleteIntent(LiveUpdateDismissals.deleteIntent(context, content.id, content.phase, requestCode(content.id, 2)))

    content.text?.let { builder.setContentText(it) }
    content.subText?.let { builder.setSubText(it) }
    parseColor(content.accentColor)?.let { builder.setColor(it) }
    // No-op below Android 16. The chip shows this text in preference to the
    // `when` time; without it the chip falls back to the countdown or icon.
    content.shortCriticalText?.let { builder.setShortCriticalText(it) }

    applyWhen(builder, content)

    val progress = content.progress
    if (progress != null && Build.VERSION.SDK_INT >= BAKLAVA) {
      builder.setStyle(progressStyle(context, progress))
    } else if (content.text != null) {
      builder.setStyle(NotificationCompat.BigTextStyle().bigText(content.text))
    }

    if (content.actionLabel != null && content.actionUrl != null) {
      builder.addAction(
        NotificationCompat.Action.Builder(
          IconCompat.createWithResource(context, iconRes(content.icon)),
          content.actionLabel,
          viewIntent(context, content.actionUrl, requestCode(content.id, 1)),
        ).build(),
      )
    }

    manager.notify(TAG_PREFIX + content.id, notificationId(content.id), builder.build())
    return true
  }

  /**
   * Countdown (upcoming start) or count-up (time since the call). Everything
   * else hides `when`: a visible past `when` time made the Android 16 chip
   * prefer the time slot and render the icon alone, dropping the count.
   */
  private fun applyWhen(builder: NotificationCompat.Builder, content: LiveUpdateContent) {
    val now = System.currentTimeMillis()
    val countdownTo = content.countdownTo
    val countUpFrom = content.countUpFrom
    when {
      countdownTo != null && countdownTo > now ->
        builder
          .setWhen(countdownTo)
          .setShowWhen(true)
          .setUsesChronometer(true)
          .setChronometerCountDown(true)
      countUpFrom != null ->
        builder
          .setWhen(minOf(countUpFrom, now))
          .setShowWhen(true)
          .setUsesChronometer(true)
          .setChronometerCountDown(false)
      else -> builder.setShowWhen(false).setUsesChronometer(false)
    }
  }

  private fun progressStyle(context: Context, progress: LiveUpdateProgress): NotificationCompat.ProgressStyle {
    val style = NotificationCompat.ProgressStyle()
      .setStyledByProgress(true)
      .setProgressSegments(
        progress.segments.filter { it.length > 0 }.map { segment ->
          NotificationCompat.ProgressStyle.Segment(segment.length).also { s ->
            parseColor(segment.color)?.let { s.setColor(it) }
          }
        },
      )
      .setProgressPoints(
        progress.points.map { point ->
          NotificationCompat.ProgressStyle.Point(point.position).also { p ->
            parseColor(point.color)?.let { p.setColor(it) }
          }
        },
      )
      .setProgress(progress.value)
    progress.tracker?.let { style.setProgressTrackerIcon(IconCompat.createWithResource(context, iconRes(it))) }
    return style
  }

  fun dismiss(context: Context, id: String) {
    manager(context).cancel(TAG_PREFIX + id, notificationId(id))
  }

  fun activeIds(context: Context): List<String> =
    manager(context).activeNotifications
      .mapNotNull { it.tag }
      .filter { it.startsWith(TAG_PREFIX) }
      .map { it.removePrefix(TAG_PREFIX) }
      .distinct()

  private fun manager(context: Context) =
    context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  private fun ensureChannels(context: Context, manager: NotificationManager) {
    // Routine updates (position, ETA, counters) stay silent; promotion only
    // requires the channel not to be IMPORTANCE_MIN.
    val routine = NotificationChannel(
      ROUTINE_CHANNEL,
      context.getString(R.string.hackos_live_updates_channel),
      NotificationManager.IMPORTANCE_DEFAULT,
    ).apply {
      setSound(null, null)
      enableVibration(false)
      setShowBadge(false)
    }
    // Used only for the alerting post (e.g. the team was called, H29).
    val alert = NotificationChannel(
      ALERT_CHANNEL,
      context.getString(R.string.hackos_live_updates_alert_channel),
      NotificationManager.IMPORTANCE_HIGH,
    ).apply { setShowBadge(false) }
    // Re-creating an existing channel only refreshes its localized name.
    manager.createNotificationChannels(listOf(routine, alert))
  }

  private fun viewIntent(context: Context, url: String, requestCode: Int): PendingIntent {
    // Pinned to this package so a deep link can never resolve to another app.
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context,
      requestCode,
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
  }

  private fun iconRes(icon: String): Int = when (icon) {
    "queue" -> R.drawable.hackos_live_update_queue
    "meal" -> R.drawable.hackos_live_update_meal
    "tracker-waiting" -> R.drawable.hackos_live_update_tracker_waiting
    "tracker-called" -> R.drawable.hackos_live_update_tracker_called
    "tracker-in-room" -> R.drawable.hackos_live_update_tracker_in_room
    else -> R.drawable.hackos_live_update_activity
  }

  private fun parseColor(hex: String?): Int? =
    hex?.let { runCatching { Color.parseColor(it) }.getOrNull() }

  private fun notificationId(id: String): Int = id.hashCode()

  private fun requestCode(id: String, slot: Int): Int = id.hashCode() * 31 + slot
}
