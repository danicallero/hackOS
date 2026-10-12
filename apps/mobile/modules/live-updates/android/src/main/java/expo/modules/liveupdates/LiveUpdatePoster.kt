package expo.modules.liveupdates

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.text.SpannableString
import android.util.Log
import android.text.Spanned
import android.text.style.StyleSpan
import androidx.core.app.NotificationCompat
import androidx.core.graphics.drawable.IconCompat

/**
 * Posts Android Live Updates (#966, H38, H25, H26, H59, H19, H22). Hybrid, because promotion
 * forbids custom views and colorized notifications:
 *
 * - Promoted (Android 16+ and `canPostPromotedNotifications()`): a real Live
 *   Update — status-bar chip, lock screen, top of the shade — with the hero
 *   datum as title, a round badge as large icon and a ProgressStyle track.
 * - Custom card (everything else): an ongoing notification with
 *   DecoratedCustomViewStyle and the iOS-like card of [LiveUpdateCardViews].
 *   Also used when the promoted build fails the system's promotable checks.
 */
object LiveUpdatePoster {
  const val TAG_PREFIX = "hackos.live-update:"
  private const val ROUTINE_CHANNEL = "hackos_live_updates"
  private const val ALERT_CHANNEL = "hackos_live_updates_alert"
  private const val BAKLAVA = 36
  private const val LOG_TAG = "LiveUpdates"

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

    val canPromote = canPostPromoted(context)
    val candidate = if (canPromote) promoted(context, content).build() else null
    val promotable = candidate != null && Build.VERSION.SDK_INT >= BAKLAVA && candidate.hasPromotableCharacteristics()
    val path = choosePath(Build.VERSION.SDK_INT, canPromote, promotable)
    val notification = if (path == Path.PROMOTED) candidate!! else card(context, content).build()

    val tag = TAG_PREFIX + content.id
    manager.notify(tag, notificationId(content.id), notification)
    if (Build.VERSION.SDK_INT >= BAKLAVA) {
      // The system sets FLAG_PROMOTED_ONGOING on the posted record.
      val posted = manager.activeNotifications.firstOrNull { it.tag == tag }?.notification
      val flagged = posted != null && posted.flags and android.app.Notification.FLAG_PROMOTED_ONGOING != 0
      Log.d(LOG_TAG, "post id=${content.id} path=$path canPostPromoted=$canPromote promotable=$promotable promotedFlag=$flagged")
    }
    return true
  }

  enum class Path { PROMOTED, CARD }

  /**
   * The custom card only when promotion is truly unavailable: below Android
   * 16, promotion revoked (user/OEM), or a promoted build the system would
   * not promote. Never by accident on a device that can promote.
   */
  fun choosePath(sdk: Int, canPostPromoted: Boolean, promotable: Boolean): Path =
    if (sdk >= BAKLAVA && canPostPromoted && promotable) Path.PROMOTED else Path.CARD

  private fun base(context: Context, content: LiveUpdateContent): NotificationCompat.Builder {
    val channel = if (content.alert) ALERT_CHANNEL else ROUTINE_CHANNEL
    return NotificationCompat.Builder(context, channel)
      // The kind's monochrome glyph, never the app logo.
      .setSmallIcon(LiveUpdateArt.glyphRes(content.icon))
      .setColor(LiveUpdateArt.tone(context, content.tone))
      .setContentTitle(content.title)
      .setOngoing(true)
      .setOnlyAlertOnce(!content.alert)
      .setCategory(NotificationCompat.CATEGORY_STATUS)
      .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
      .setContentIntent(viewIntent(context, content.url, requestCode(content.id, 0)))
      .setDeleteIntent(LiveUpdateDismissals.deleteIntent(context, content.id, content.phase, requestCode(content.id, 2)))
      .apply { sortKey(content.rank)?.let { setSortKey(it) } }
  }

  /**
   * The device rank as a sort key (sort keys compare as strings): rank 0
   * sorts before rank 1, and before 10. Null leaves the system order.
   */
  fun sortKey(rank: Int?): String? =
    rank?.takeIf { it >= 0 }?.let { "hackos-" + it.toString().padStart(4, '0') }

  private fun promoted(context: Context, content: LiveUpdateContent): NotificationCompat.Builder {
    val builder = base(context, content)
      .setRequestPromotedOngoing(true)
      .setContentTitle(emphasized(content.title, content.emphasis))
      .setLargeIcon(LiveUpdateArt.badge(context, content.icon, content.tone, 48f))
    content.text?.let { builder.setContentText(it) }
    content.subText?.let { builder.setSubText(it) }
    // The chip shows this text in preference to the `when` time; without it
    // the chip falls back to the `when` time (time left, or the count-up since
    // the call) or the small icon.
    content.shortCriticalText?.let { builder.setShortCriticalText(it) }
    applyWhen(builder, content)

    val progress = content.progress
    if (progress != null) {
      builder.setStyle(progressStyle(context, progress))
    } else if (content.text != null) {
      builder.setStyle(NotificationCompat.BigTextStyle().bigText(content.text))
    }
    action(context, content)?.let { builder.addAction(it) }
    return builder
  }

  private fun card(context: Context, content: LiveUpdateContent): NotificationCompat.Builder {
    val builder = base(context, content).setRequestPromotedOngoing(false)
    content.text?.let { builder.setContentText(it) }
    val card = content.card
    if (card == null) {
      applyWhen(builder, content)
      action(context, content)?.let { builder.addAction(it) }
      return builder
    }
    // The card carries its own timers and the Scan button.
    builder.setShowWhen(false)
    val actionIntent = content.actionUrl?.let { viewIntent(context, it, requestCode(content.id, 1)) }
    return builder
      .setStyle(NotificationCompat.DecoratedCustomViewStyle())
      .setCustomContentView(LiveUpdateCardViews.small(context, content, card))
      .setCustomBigContentView(LiveUpdateCardViews.big(context, content, card, actionIntent))
  }

  private fun action(context: Context, content: LiveUpdateContent): NotificationCompat.Action? {
    val label = content.actionLabel ?: return null
    val url = content.actionUrl ?: return null
    // Promoted notifications cannot be colorized: SystemUI draws actions as
    // text buttons, strips colour/background spans and hides action icons
    // (verified on Android 16). Bold survives, so the label is bold.
    val title = SpannableString(label).apply {
      setSpan(StyleSpan(Typeface.BOLD), 0, length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
    return NotificationCompat.Action.Builder(
      IconCompat.createWithResource(context, R.drawable.hackos_live_update_scan),
      title,
      viewIntent(context, url, requestCode(content.id, 1)),
    ).build()
  }

  /** The hero number in bold, e.g. "**~12 min** · #4"; plain when it does not lead the title. */
  private fun emphasized(title: String, emphasis: String?): CharSequence {
    if (emphasis.isNullOrEmpty()) return title
    val start = title.indexOf(emphasis)
    if (start < 0) return title
    return SpannableString(title).apply {
      setSpan(StyleSpan(Typeface.BOLD), start, start + emphasis.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
    }
  }

  /** How the promoted notification shows its `when` instant (chip and header). */
  enum class WhenStyle {
    /**
     * A countdown as the system's own short time delta (`5min`, `1hr`), never
     * the chronometer's H:MM:SS, which would not fit beside the icon (#966).
     */
    TIME_LEFT,
    /** The time since the call, a ticking chronometer. */
    COUNT_UP,
    /** No `when`, so a live count is never displaced from the chip. */
    NONE,
  }

  fun whenStyle(countdownTo: Long?, countUpFrom: Long?, now: Long): WhenStyle = when {
    countdownTo != null && countdownTo > now -> WhenStyle.TIME_LEFT
    countUpFrom != null -> WhenStyle.COUNT_UP
    else -> WhenStyle.NONE
  }

  /**
   * Countdown (upcoming start) or count-up (time since the call). Everything
   * else hides `when`.
   */
  private fun applyWhen(builder: NotificationCompat.Builder, content: LiveUpdateContent) {
    val now = System.currentTimeMillis()
    when (whenStyle(content.countdownTo, content.countUpFrom, now)) {
      WhenStyle.TIME_LEFT ->
        builder.setWhen(content.countdownTo!!).setShowWhen(true).setUsesChronometer(false)
      WhenStyle.COUNT_UP ->
        builder
          .setWhen(minOf(content.countUpFrom!!, now))
          .setShowWhen(true)
          .setUsesChronometer(true)
          .setChronometerCountDown(false)
      WhenStyle.NONE -> builder.setShowWhen(false).setUsesChronometer(false)
    }
  }

  /**
   * The JS mapping already split each stage into its filled part (stage
   * colour) and its grey rest (the platform draws the gaps between segments),
   * so the colours are used as given, not faded by progress.
   */
  private fun progressStyle(context: Context, progress: LiveUpdateProgress): NotificationCompat.ProgressStyle {
    val style = NotificationCompat.ProgressStyle()
      .setStyledByProgress(false)
      .setProgressSegments(
        progress.segments.filter { it.length > 0 }.map {
          NotificationCompat.ProgressStyle.Segment(it.length).setColor(LiveUpdateArt.tone(context, it.tone))
        },
      )
      .setProgress(progress.value)
    progress.tracker?.let {
      style.setProgressTrackerIcon(IconCompat.createWithBitmap(LiveUpdateArt.tracker(context, it, progress.trackerTone, 24f)))
    }
    progress.endGlyph?.let { style.setProgressEndIcon(IconCompat.createWithBitmap(LiveUpdateArt.glyph(context, it, 20f))) }
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

  private fun notificationId(id: String): Int = id.hashCode()

  private fun requestCode(id: String, slot: Int): Int = id.hashCode() * 31 + slot
}
