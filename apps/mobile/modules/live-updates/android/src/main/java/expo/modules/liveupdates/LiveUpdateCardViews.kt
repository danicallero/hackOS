package expo.modules.liveupdates

import android.app.PendingIntent
import android.content.Context
import android.os.Build
import android.os.SystemClock
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews

/**
 * The custom card (#966): the non-promoted path, used below Android 16 and
 * whenever promotion is unavailable (revoked by the user, refused by the
 * system or an OEM). Promotion forbids custom views, which is why the
 * promoted path cannot look like this. Layouts mirror the iOS Live Activity
 * Lock Screen: header, large metrics (one in the phase colour), stats, the
 * queue stage track or a bar, and the Scan button inside the card.
 */
object LiveUpdateCardViews {
  fun small(context: Context, content: LiveUpdateContent, card: LiveUpdateCard): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.hackos_live_update_card_small)
    views.setTextViewText(R.id.lu_header, card.header)
    // Collapsed: the card's hero metric (a stat for meals) and the trailing one.
    val hero = card.stats.firstOrNull { it.hero } ?: card.lead
    metric(context, views, content, hero, R.id.lu_lead_caption, R.id.lu_lead_value, R.id.lu_lead_timer, hero.tone ?: content.tone, 17f)
    val trail = card.trail.takeIf { hero === card.lead }
    metric(context, views, content, trail, null, R.id.lu_trail_value, R.id.lu_trail_timer, trail?.tone, 15f)
    return views
  }

  fun big(context: Context, content: LiveUpdateContent, card: LiveUpdateCard, actionIntent: PendingIntent?): RemoteViews {
    val views = RemoteViews(context.packageName, R.layout.hackos_live_update_card_big)
    views.setTextViewText(R.id.lu_header, card.header)
    text(views, R.id.lu_header_trailing, card.headerTrailing)

    val footerTo = card.footerCountdownTo
    if (footerTo != null && footerTo > System.currentTimeMillis()) {
      text(views, R.id.lu_footer_caption, card.footerCaption)
      timer(views, R.id.lu_footer_timer, footerTo, countDown = true)
    }

    // A stats row replaces the metrics row (meals: served · still to eat · inside).
    if (card.stats.isNotEmpty()) {
      views.setViewVisibility(R.id.lu_metrics, View.GONE)
      val ids = listOf(
        Triple(R.id.lu_stat0, R.id.lu_stat0_caption, R.id.lu_stat0_value),
        Triple(R.id.lu_stat1, R.id.lu_stat1_caption, R.id.lu_stat1_value),
        Triple(R.id.lu_stat2, R.id.lu_stat2_caption, R.id.lu_stat2_value),
      )
      ids.forEachIndexed { i, (column, caption, value) ->
        val stat = card.stats.getOrNull(i)
        if (stat == null) {
          views.setViewVisibility(column, View.GONE)
          return@forEachIndexed
        }
        text(views, caption, stat.caption)
        text(views, value, stat.value)
        (stat.tone ?: content.tone.takeIf { stat.hero })?.let { textColor(context, views, value, LiveUpdateArt.toneRes(it)) }
      }
    } else {
      views.setViewVisibility(R.id.lu_stats, View.GONE)
      metric(context, views, content, card.lead, R.id.lu_lead_caption, R.id.lu_lead_value, R.id.lu_lead_timer, toneOf(content, card.lead), 22f)
      if (card.trail == null) {
        views.setViewVisibility(R.id.lu_trail, View.GONE)
      } else {
        metric(context, views, content, card.trail, R.id.lu_trail_caption, R.id.lu_trail_value, R.id.lu_trail_timer, toneOf(content, card.trail), 17f)
      }
    }
    text(views, R.id.lu_detail, card.detail)

    val width = LiveUpdateArt.cardWidth(context)
    val progress = content.progress
    val hasAction = actionIntent != null && content.actionLabel != null
    // Full-width track (queue stages) or a track beside the Scan button.
    if (progress != null && !hasAction) {
      views.setImageViewBitmap(R.id.lu_track, LiveUpdateArt.track(context, width, progress, card.trackLabels, card.currentStop))
      card.currentStop?.let { stop -> card.trackLabels.getOrNull(stop)?.let { views.setContentDescription(R.id.lu_track, it) } }
    } else {
      views.setViewVisibility(R.id.lu_track, View.GONE)
    }
    if (!hasAction) {
      views.setViewVisibility(R.id.lu_bottom, View.GONE)
    } else {
      if (progress != null) {
        // Leave room for the button so the track keeps its nominal size.
        val trackWidth = (width * 0.62f).toInt()
        views.setImageViewBitmap(R.id.lu_bar, LiveUpdateArt.track(context, trackWidth, progress, emptyList(), null))
      } else {
        views.setViewVisibility(R.id.lu_bar, View.INVISIBLE)
      }
      views.setTextViewText(R.id.lu_action, content.actionLabel)
      views.setTextViewCompoundDrawablesRelative(R.id.lu_action, R.drawable.hackos_lu_scan_small, 0, 0, 0)
      views.setOnClickPendingIntent(R.id.lu_action, actionIntent)
    }
    return views
  }

  private fun metric(
    context: Context,
    views: RemoteViews,
    content: LiveUpdateContent,
    metric: LiveUpdateMetric?,
    captionId: Int?,
    valueId: Int,
    timerId: Int,
    tone: String?,
    quietSizeSp: Float? = null,
  ) {
    captionId?.let { text(views, it, metric?.caption) }
    val target = when (metric?.timer) {
      "countDown" -> content.countdownTo?.takeIf { it > System.currentTimeMillis() }
      "countUp" -> content.countUpFrom
      else -> null
    }
    if (target != null) {
      views.setViewVisibility(valueId, View.GONE)
      timer(views, timerId, target, countDown = metric?.timer == "countDown")
      tone?.let { textColor(context, views, timerId, LiveUpdateArt.toneRes(it)) }
      // A secondary timer (the deadline's time left once submitted) stays small.
      if (metric?.quiet == true && quietSizeSp != null) {
        views.setTextViewTextSize(timerId, TypedValue.COMPLEX_UNIT_SP, quietSizeSp)
      }
    } else {
      text(views, valueId, metric?.value)
      tone?.let { textColor(context, views, valueId, LiveUpdateArt.toneRes(it)) }
      // A placeholder is not a number: about 60% of the metric size, as on iOS.
      if (metric?.quiet == true && quietSizeSp != null) {
        views.setTextViewTextSize(valueId, TypedValue.COMPLEX_UNIT_SP, quietSizeSp)
      }
    }
  }

  /** The metric's own colour, else the phase colour for the hero. */
  private fun toneOf(content: LiveUpdateContent, metric: LiveUpdateMetric): String? =
    metric.tone ?: content.tone.takeIf { metric.hero }

  private fun text(views: RemoteViews, id: Int, value: String?) {
    if (value.isNullOrEmpty()) {
      views.setViewVisibility(id, View.GONE)
    } else {
      views.setViewVisibility(id, View.VISIBLE)
      views.setTextViewText(id, value)
    }
  }

  private fun timer(views: RemoteViews, id: Int, epochMs: Long, countDown: Boolean) {
    // Chronometer bases are elapsed-realtime.
    val base = SystemClock.elapsedRealtime() + (epochMs - System.currentTimeMillis())
    views.setViewVisibility(id, View.VISIBLE)
    views.setChronometer(id, base, null, true)
    views.setChronometerCountDown(id, countDown)
  }

  /** Night-aware where supported: resolved when SystemUI inflates the card. */
  private fun textColor(context: Context, views: RemoteViews, id: Int, colorRes: Int) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      views.setColor(id, "setTextColor", colorRes)
    } else {
      views.setTextColor(id, LiveUpdateArt.color(context, colorRes))
    }
  }
}
