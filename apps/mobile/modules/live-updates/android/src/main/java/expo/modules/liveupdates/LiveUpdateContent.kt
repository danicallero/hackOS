package expo.modules.liveupdates

/** Platform-neutral copy of the JS `LiveUpdateSpec` (#966); see `index.ts` for the field docs. */
data class LiveUpdateContent(
  val id: String,
  val title: String,
  val text: String? = null,
  val subText: String? = null,
  val emphasis: String? = null,
  val shortCriticalText: String? = null,
  val countdownTo: Long? = null,
  val countUpFrom: Long? = null,
  val progress: LiveUpdateProgress? = null,
  val card: LiveUpdateCard? = null,
  val phase: String? = null,
  val url: String,
  val actionLabel: String? = null,
  val actionUrl: String? = null,
  /** `accent` | `go` | `neutral` | `warning` | `alert`. */
  val tone: String = "accent",
  /** Glyph name, see [LiveUpdateArt.glyphRes]. */
  val icon: String = "people",
  val alert: Boolean = false,
  /** Device rank (0 = most important), the post's sort key. */
  val rank: Int? = null,
)

data class LiveUpdateSegment(val length: Int, val tone: String)

data class LiveUpdateProgress(
  val value: Int,
  val segments: List<LiveUpdateSegment>,
  val tracker: String? = null,
  val trackerTone: String? = null,
  val endGlyph: String? = null,
  val stops: List<Int> = emptyList(),
)

data class LiveUpdateMetric(
  val caption: String? = null,
  val value: String? = null,
  /** `countDown` (to `countdownTo`) or `countUp` (from `countUpFrom`). */
  val timer: String? = null,
  val hero: Boolean = false,
  val quiet: Boolean = false,
  /** Value colour when it differs from the phase colour (e.g. an amber status). */
  val tone: String? = null,
)

data class LiveUpdateCard(
  val header: String,
  val headerTrailing: String? = null,
  val lead: LiveUpdateMetric,
  val trail: LiveUpdateMetric? = null,
  val detail: String? = null,
  val stats: List<LiveUpdateMetric> = emptyList(),
  val trackLabels: List<String> = emptyList(),
  val currentStop: Int? = null,
  val footerCaption: String? = null,
  val footerCountdownTo: Long? = null,
)
