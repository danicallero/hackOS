package expo.modules.liveupdates

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import androidx.core.content.ContextCompat
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Colours, glyphs and bitmaps for Live Updates (#966). Promoted notifications
 * and RemoteViews take no vector paths or dynamic shapes, so the round
 * badges, the progress tracker and the card's stage track are drawn here.
 * Bitmaps use the light/dark mode at post time; the card's text colours are
 * resources that RemoteViews resolve in the system's configuration.
 */
object LiveUpdateArt {
  fun isNight(context: Context): Boolean =
    (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
      Configuration.UI_MODE_NIGHT_YES

  fun toneRes(tone: String?): Int = when (tone) {
    "go" -> R.color.hackos_lu_go
    "neutral" -> R.color.hackos_lu_neutral
    "travelled" -> R.color.hackos_lu_travelled
    else -> R.color.hackos_lu_accent
  }

  fun color(context: Context, res: Int): Int = ContextCompat.getColor(context, res)

  fun tone(context: Context, tone: String?): Int = color(context, toneRes(tone))

  fun glyphRes(name: String?): Int = when (name) {
    "door" -> R.drawable.hackos_live_update_door
    "queue" -> R.drawable.hackos_live_update_queue
    "meal" -> R.drawable.hackos_live_update_meal
    "mic" -> R.drawable.hackos_live_update_mic
    "star" -> R.drawable.hackos_live_update_star
    "scan" -> R.drawable.hackos_live_update_scan
    else -> R.drawable.hackos_live_update_people
  }

  private fun dp(context: Context, value: Float): Float = value * context.resources.displayMetrics.density

  private fun drawGlyph(context: Context, canvas: Canvas, glyph: String?, color: Int, cx: Float, cy: Float, size: Float) {
    val drawable = ContextCompat.getDrawable(context, glyphRes(glyph))?.mutate() ?: return
    drawable.setTint(color)
    val half = size / 2
    drawable.setBounds((cx - half).roundToInt(), (cy - half).roundToInt(), (cx + half).roundToInt(), (cy + half).roundToInt())
    drawable.draw(canvas)
  }

  /** A white glyph on a disc in the tone colour (the large-icon badge). */
  fun badge(context: Context, glyph: String?, tone: String?, sizeDp: Float): Bitmap {
    val size = dp(context, sizeDp).roundToInt()
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = tone(context, tone) }
    val c = size / 2f
    canvas.drawCircle(c, c, c, paint)
    drawGlyph(context, canvas, glyph, Color.WHITE, c, c, c * 1.15f)
    return bitmap
  }

  /** The track's tracker, like Maps: a glyph in the tone colour on a white disc with a hairline. */
  fun tracker(context: Context, glyph: String?, tone: String?, sizeDp: Float): Bitmap {
    val size = dp(context, sizeDp).roundToInt()
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    drawTracker(context, Canvas(bitmap), glyph, tone, size / 2f, size / 2f, size / 2f)
    return bitmap
  }

  private fun drawTracker(context: Context, canvas: Canvas, glyph: String?, tone: String?, cx: Float, cy: Float, radius: Float) {
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    paint.color = color(context, R.color.hackos_lu_travelled)
    canvas.drawCircle(cx, cy, radius, paint)
    paint.color = Color.WHITE
    canvas.drawCircle(cx, cy, radius - dp(context, 1f), paint)
    drawGlyph(context, canvas, glyph, tone(context, tone), cx, cy, radius * 1.25f)
  }

  /** A bare glyph in the secondary colour (the track's start and end icons). */
  fun glyph(context: Context, glyph: String?, sizeDp: Float): Bitmap {
    val size = dp(context, sizeDp).roundToInt()
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    drawGlyph(context, Canvas(bitmap), glyph, color(context, R.color.hackos_lu_secondary), size / 2f, size / 2f, size.toFloat())
    return bitmap
  }

  /**
   * Content width of a notification card, approximately: the bitmaps are
   * drawn at this size and scaled to the actual width, so text and dots keep
   * (nearly) their nominal size.
   */
  fun cardWidth(context: Context): Int {
    val metrics = context.resources.displayMetrics
    val width = minOf(metrics.widthPixels, dp(context, 480f).roundToInt())
    return max(dp(context, 200f).roundToInt(), width - dp(context, 64f).roundToInt())
  }

  /**
   * The card's track (H38 queue stages, H24 served share), drawn like the
   * promoted ProgressStyle: grey travelled part, the remaining stages in
   * their colours with gaps between segments, a round tracker at `value`,
   * and labels under `stops` (first left, last right, others centred).
   */
  fun track(context: Context, width: Int, progress: LiveUpdateProgress, labels: List<String>, currentStop: Int?): Bitmap {
    val total = progress.segments.sumOf { it.length }.coerceAtLeast(1).toFloat()
    val hasTracker = progress.tracker != null
    val trackerSize = dp(context, 22f)
    val line = dp(context, 6f)
    val gap = dp(context, 4f)
    val labelSize = dp(context, 12f)
    val showLabels = labels.isNotEmpty() && labels.size == progress.stops.size
    val trackHeight = if (hasTracker) trackerSize else line
    val height = (trackHeight + if (showLabels) labelSize + dp(context, 8f) else 0f).roundToInt()
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    val cy = trackHeight / 2
    // Room for the tracker at either end.
    val inset = if (hasTracker) trackerSize / 2 else 0f
    val left = inset
    val span = width - 2 * inset
    fun x(position: Float) = left + span * (position / total)

    var start = 0f
    progress.segments.forEachIndexed { i, segment ->
      val from = x(start) + if (i > 0) gap / 2 else 0f
      val to = x(start + segment.length) - if (i < progress.segments.lastIndex) gap / 2 else 0f
      if (to > from) {
        paint.color = tone(context, segment.tone)
        canvas.drawRoundRect(RectF(from, cy - line / 2, to, cy + line / 2), line / 2, line / 2, paint)
      }
      start += segment.length
    }
    if (hasTracker) {
      drawTracker(context, canvas, progress.tracker, progress.trackerTone, x(progress.value.toFloat()), cy, trackerSize / 2)
    }

    if (showLabels) {
      val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = labelSize }
      val baseline = trackHeight + dp(context, 4f) + labelSize
      labels.forEachIndexed { i, label ->
        val current = i == currentStop
        text.typeface = Typeface.create("sans-serif-medium", if (current) Typeface.BOLD else Typeface.NORMAL)
        text.color = color(context, if (current) R.color.hackos_lu_primary else R.color.hackos_lu_secondary)
        val w = text.measureText(label)
        val at = x(progress.stops[i].toFloat())
        val lx = when (i) {
          0 -> 0f
          labels.lastIndex -> width - w
          else -> (at - w / 2).coerceIn(0f, width - w)
        }
        canvas.drawText(label, lx, baseline, text)
      }
    }
    return bitmap
  }
}
