package expo.modules.liveupdates

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Bundle

/** Platform-neutral copy of the JS `LiveUpdateSpec` (#966). */
data class LiveUpdateContent(
  val id: String,
  val title: String,
  val text: String?,
  val shortCriticalText: String?,
  val subText: String?,
  val countdownTo: Long?,
  val url: String,
  val actionLabel: String?,
  val actionUrl: String?,
  val accentColor: String?,
  val icon: String,
  val alert: Boolean,
)

/**
 * Posts Android Live Updates (#966, H38, H25, H26): promoted ongoing
 * notifications. Android 16+ shows them as a status-bar chip and on the lock
 * screen; older versions, or users who revoked promotion, get the same
 * notification as a plain ongoing one. Uses the platform builder because every
 * promoted API is platform-level and the module already requires API 26.
 */
object LiveUpdatePoster {
  const val TAG_PREFIX = "hackos.live-update:"
  private const val ROUTINE_CHANNEL = "hackos_live_updates"
  private const val ALERT_CHANNEL = "hackos_live_updates_alert"

  // Notification.EXTRA_REQUEST_PROMOTED_ONGOING is only public from API 36.1;
  // the extra itself is honoured on every Android 16 build.
  private const val EXTRA_REQUEST_PROMOTED_ONGOING = "android.requestPromotedOngoing"
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
    val builder = Notification.Builder(context, channel)
      .setSmallIcon(iconRes(content.icon))
      .setContentTitle(content.title)
      .setOngoing(true)
      .setOnlyAlertOnce(!content.alert)
      .setCategory(Notification.CATEGORY_STATUS)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setContentIntent(viewIntent(context, content.url, requestCode(content.id, 0)))

    content.text?.let { builder.setContentText(it).setStyle(Notification.BigTextStyle().bigText(it)) }
    content.subText?.let { builder.setSubText(it) }
    parseColor(content.accentColor)?.let { builder.setColor(it) }

    val countdownTo = content.countdownTo
    if (countdownTo != null && countdownTo > System.currentTimeMillis()) {
      builder
        .setWhen(countdownTo)
        .setShowWhen(true)
        .setUsesChronometer(true)
        .setChronometerCountDown(true)
    } else {
      builder.setShowWhen(false)
    }

    if (content.actionLabel != null && content.actionUrl != null) {
      builder.addAction(
        Notification.Action.Builder(
          Icon.createWithResource(context, iconRes(content.icon)),
          content.actionLabel,
          viewIntent(context, content.actionUrl, requestCode(content.id, 1)),
        ).build(),
      )
    }

    if (Build.VERSION.SDK_INT >= BAKLAVA) {
      content.shortCriticalText?.let { builder.setShortCriticalText(it) }
    }
    builder.addExtras(
      Bundle().apply {
        putBoolean(EXTRA_REQUEST_PROMOTED_ONGOING, true)
      },
    )

    manager.notify(TAG_PREFIX + content.id, notificationId(content.id), builder.build())
    return true
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
    else -> R.drawable.hackos_live_update_activity
  }

  private fun parseColor(hex: String?): Int? =
    hex?.let { runCatching { Color.parseColor(it) }.getOrNull() }

  private fun notificationId(id: String): Int = id.hashCode()

  private fun requestCode(id: String, slot: Int): Int = id.hashCode() * 31 + slot
}
