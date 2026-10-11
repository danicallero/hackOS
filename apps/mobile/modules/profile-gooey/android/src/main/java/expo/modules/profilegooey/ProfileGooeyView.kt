package expo.modules.profilegooey

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RenderEffect
import android.graphics.RenderNode
import android.graphics.Shader
import android.os.Build
import android.view.View
import androidx.annotation.RequiresApi
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * Android hole-punch profile avatar morph. The single React child (the avatar
 * photo or initials, laid out once by Yoga at the expanded frame) is drawn
 * here scaled uniformly onto the animated circle and clipped to it, so its
 * layout never changes. It darkens and blurs into a black disc; once fully
 * black it is handed to the "ink" silhouette (lens + avatar + a metaball neck
 * + a short drip) that fuses it into the camera lens. Android 12+ softens the
 * ink with a blur + alpha threshold. Every frame value comes from
 * `profileGooeyFrame` (lib/profile-avatar-collapse.ts).
 */
class ProfileGooeyView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  // dp, view-local
  var holeX = 0f
  var holeY = 0f
  var holeDiameter = 0f
  var avatarX = 0f
  var avatarY = 0f
  var avatarDiameter = 0f
  var darkness = 0f
  var blurRadius = 0f
  var bridgeReach = 0f
  var pill = 0f
  var drip = 0f

  private val density = resources.displayMetrics.density
  private val inkPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.BLACK }
  private val avatarClip = Path()
  private val bridge = Path()
  private val dripPath = Path()
  private val effects: Effects? =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) Effects() else null

  // ExpoView is a LinearLayout: an Android layout pass would stack and stretch
  // the React child (moving it to the top-left and resizing it), so measure
  // only this view and leave the child exactly where Yoga put it.
  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(
      MeasureSpec.getSize(widthMeasureSpec),
      MeasureSpec.getSize(heightMeasureSpec),
    )
  }

  override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) = Unit

  override fun dispatchDraw(canvas: Canvas) {
    val child = if (childCount > 0) getChildAt(0) else null
    if (child == null || child.width == 0 || avatarDiameter <= 0f) return
    val fx = if (canvas.isHardwareAccelerated) effects else null
    if (darkness < 1f) {
      val r = avatarDiameter * density / 2f
      avatarClip.rewind()
      avatarClip.addCircle(avatarX * density, avatarY * density, r, Path.Direction.CW)
      canvas.save()
      // The clip also trims the blur, so nothing bleeds outside the circle.
      canvas.clipPath(avatarClip)
      // A black underlay fills the rim the blur leaves translucent.
      if (darkness > 0f || blurRadius > 0f) canvas.drawColor(Color.BLACK)
      if (fx != null) fx.drawContent(canvas, child) else drawAvatar(canvas, child)
      if (darkness > 0f) canvas.drawColor(Color.argb((darkness * 255).roundToInt(), 0, 0, 0))
      canvas.restore()
    }
    // The ink sits above the avatar; until it is fully black only the lens
    // is drawn, then its own disc replaces the avatar seamlessly.
    if (fx != null) fx.drawInk(canvas) else drawInk(canvas)
  }

  override fun onDetachedFromWindow() {
    effects?.release()
    super.onDetachedFromWindow()
  }

  /** The child scaled about its centre onto the animated circle. */
  private fun drawAvatar(canvas: Canvas, child: View) {
    val scale = avatarDiameter * density / child.width
    canvas.save()
    canvas.translate(avatarX * density, avatarY * density)
    canvas.scale(scale, scale)
    canvas.translate(-(child.left + child.width / 2f), -(child.top + child.height / 2f))
    drawChild(canvas, child, drawingTime)
    canvas.restore()
  }

  /**
   * Each shape is painted separately, so overlaps union instead of cancelling.
   * Until the avatar has darkened to black only the lens is drawn.
   */
  private fun drawInk(canvas: Canvas) {
    val hx = holeX * density
    val hy = holeY * density
    val hr = holeDiameter * density / 2f
    val ax = avatarX * density
    val ay = avatarY * density
    val ar = avatarDiameter * density / 2f
    if (hr > 0f) canvas.drawCircle(hx, hy, hr, inkPaint)
    if (darkness < 1f) return
    canvas.drawCircle(ax, ay, ar, inkPaint)
    if (hr > 0f && buildBridge(ax, ay, ar, hx, hy, hr, bridgeReach * density)) {
      canvas.drawPath(bridge, inkPaint)
    }
    if (hr > 0f && pill > 0f) {
      // The neck fattens into a straight-sided pill: a band between the two
      // centres as wide as `pill` times the smaller circle, so the union of
      // lens, band and avatar reads as one capsule that shortens into the lens.
      val half = min(hr, ar) * pill
      canvas.drawRect(hx - half, min(hy, ay), hx + half, max(hy, ay), inkPaint)
    }
    if (hr > 0f && drip > 0f) {
      // A rounded bump under the lens: a quadratic from 45° to 135° whose
      // control point hangs `drip` below the lens.
      val s = hr * cos(PI / 4).toFloat()
      dripPath.rewind()
      dripPath.moveTo(hx - s, hy + s)
      dripPath.quadTo(hx, hy + hr + 2f * drip * density, hx + s, hy + s)
      dripPath.close()
      canvas.drawPath(dripPath, inkPaint)
    }
  }

  /**
   * Two-circle metaball neck from the avatar (1) to the lens (2): tangent
   * points spread around each circle, joined by Béziers whose handles shrink
   * with distance. The spread grows from 0 at `reach` (edges that far apart),
   * so the neck emerges from a point instead of popping in.
   */
  private fun buildBridge(
    x1: Float,
    y1: Float,
    r1: Float,
    x2: Float,
    y2: Float,
    r2: Float,
    reach: Float,
  ): Boolean {
    if (reach <= 0f || r1 <= 0f || r2 <= 0f) return false
    val d = hypot(x2 - x1, y2 - y1)
    val total = r1 + r2
    if (d >= total + reach || d <= abs(r1 - r2)) return false
    val closeness = 1f - ((d - total).coerceAtLeast(0f) / reach)
    val spread = MAX_SPREAD * closeness
    var u1 = 0f
    var u2 = 0f
    if (d < total) {
      u1 = acos(((r1 * r1 + d * d - r2 * r2) / (2f * r1 * d)).coerceIn(-1f, 1f))
      u2 = acos(((r2 * r2 + d * d - r1 * r1) / (2f * r2 * d)).coerceIn(-1f, 1f))
    }
    val angle = atan2(y2 - y1, x2 - x1)
    val maxSpread = acos(((r1 - r2) / d).coerceIn(-1f, 1f))
    val pi = PI.toFloat()
    val a1 = angle + u1 + (maxSpread - u1) * spread
    val a2 = angle - u1 - (maxSpread - u1) * spread
    val a3 = angle + pi - u2 - (pi - u2 - maxSpread) * spread
    val a4 = angle - pi + u2 + (pi - u2 - maxSpread) * spread
    val p1x = x1 + r1 * cos(a1)
    val p1y = y1 + r1 * sin(a1)
    val p2x = x1 + r1 * cos(a2)
    val p2y = y1 + r1 * sin(a2)
    val p3x = x2 + r2 * cos(a3)
    val p3y = y2 + r2 * sin(a3)
    val p4x = x2 + r2 * cos(a4)
    val p4y = y2 + r2 * sin(a4)
    val handle = min(spread * HANDLE_SIZE, hypot(p3x - p1x, p3y - p1y) / total) * min(1f, d * 2f / total)
    val h1 = r1 * handle
    val h2 = r2 * handle
    val half = pi / 2f
    bridge.rewind()
    bridge.moveTo(p1x, p1y)
    bridge.cubicTo(
      p1x + h1 * cos(a1 - half), p1y + h1 * sin(a1 - half),
      p3x + h2 * cos(a3 + half), p3y + h2 * sin(a3 + half),
      p3x, p3y,
    )
    bridge.lineTo(p4x, p4y)
    bridge.cubicTo(
      p4x + h2 * cos(a4 - half), p4y + h2 * sin(a4 - half),
      p2x + h1 * cos(a2 + half), p2y + h1 * sin(a2 + half),
      p2x, p2y,
    )
    bridge.close()
    return true
  }

  /**
   * Android 12+: the ink is blurred and re-thresholded on the RenderThread
   * (surface tension), and the photo gets a progressive blur (clipped back to
   * the circle by the caller). Both nodes are
   * allocated once and reused; effects are rebuilt only when a radius changes.
   */
  @RequiresApi(Build.VERSION_CODES.S)
  private inner class Effects {
    private val inkNode = RenderNode("profileGooeyInk")
    private val contentNode = RenderNode("profileGooeyContent")
    // Alpha' = G * (alpha - 128) + 128: keeps the black, sharpens the blurred
    // edge back into a ~1.5 px anti-aliased boundary.
    private val threshold =
      Paint().apply {
        colorFilter =
          ColorMatrixColorFilter(
            floatArrayOf(
              1f, 0f, 0f, 0f, 0f,
              0f, 1f, 0f, 0f, 0f,
              0f, 0f, 1f, 0f, 0f,
              0f, 0f, 0f, ALPHA_GAIN, 128f - ALPHA_GAIN * 128f,
            ),
          )
      }
    private var inkBlur = -1f
    private var contentBlur = -1f

    fun drawInk(canvas: Canvas) {
      inkNode.setPosition(0, 0, width, height)
      val recording = inkNode.beginRecording()
      try {
        this@ProfileGooeyView.drawInk(recording)
      } finally {
        inkNode.endRecording()
      }
      val blur = INK_BLUR_DP * density
      if (blur != inkBlur) {
        inkNode.setRenderEffect(RenderEffect.createBlurEffect(blur, blur, Shader.TileMode.DECAL))
        inkBlur = blur
      }
      canvas.saveLayer(0f, 0f, width.toFloat(), height.toFloat(), threshold)
      canvas.drawRenderNode(inkNode)
      canvas.restore()
    }

    fun drawContent(canvas: Canvas, child: View) {
      contentNode.setPosition(0, 0, width, height)
      val recording = contentNode.beginRecording()
      try {
        drawAvatar(recording, child)
      } finally {
        contentNode.endRecording()
      }
      // Half-pixel steps: no new RenderEffect for sub-pixel scroll changes.
      val blur = (blurRadius * density * 2f).roundToInt() / 2f
      if (blur != contentBlur) {
        contentNode.setRenderEffect(
          if (blur >= 0.5f) RenderEffect.createBlurEffect(blur, blur, Shader.TileMode.DECAL) else null,
        )
        contentBlur = blur
      }
      canvas.drawRenderNode(contentNode)
    }

    fun release() {
      inkNode.setRenderEffect(null)
      contentNode.setRenderEffect(null)
      inkNode.discardDisplayList()
      contentNode.discardDisplayList()
      inkBlur = -1f
      contentBlur = -1f
    }
  }

  private companion object {
    /** Widest tangent spread of the neck (fraction of the available arc). */
    const val MAX_SPREAD = 0.5f
    /** Bézier handle length factor of the neck. */
    const val HANDLE_SIZE = 2.4f
    /** Ink blur before thresholding, Android 12+ (dp). */
    const val INK_BLUR_DP = 4f
    const val ALPHA_GAIN = 8f
  }
}
