package expo.modules.liveupdates

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.records.Required

class LiveUpdateActionRecord : Record {
  @Field @Required val label: String = ""

  @Field @Required val url: String = ""
}

class LiveUpdateSegmentRecord : Record {
  @Field @Required val length: Double = 0.0

  @Field val color: String? = null
}

class LiveUpdatePointRecord : Record {
  @Field @Required val position: Double = 0.0

  @Field val color: String? = null
}

class LiveUpdateProgressRecord : Record {
  @Field @Required val value: Double = 0.0

  @Field @Required val segments: List<LiveUpdateSegmentRecord> = emptyList()

  @Field val points: List<LiveUpdatePointRecord>? = null

  @Field val tracker: String? = null

  fun toProgress() = LiveUpdateProgress(
    value = value.toInt(),
    segments = segments.map { LiveUpdateSegment(it.length.toInt(), it.color) },
    points = points.orEmpty().map { LiveUpdatePoint(it.position.toInt(), it.color) },
    tracker = tracker,
  )
}

class LiveUpdateSpecRecord : Record {
  @Field @Required val id: String = ""

  @Field @Required val title: String = ""

  @Field val text: String? = null

  @Field val shortCriticalText: String? = null

  @Field val subText: String? = null

  @Field val countdownTo: Double? = null

  @Field val countUpFrom: Double? = null

  @Field val progress: LiveUpdateProgressRecord? = null

  @Field val phase: String? = null

  @Field @Required val url: String = ""

  @Field val action: LiveUpdateActionRecord? = null

  @Field val accentColor: String? = null

  @Field val icon: String = "activity"

  @Field val alert: Boolean = false

  fun toContent() = LiveUpdateContent(
    id = id,
    title = title,
    text = text,
    shortCriticalText = shortCriticalText,
    subText = subText,
    countdownTo = countdownTo?.toLong(),
    countUpFrom = countUpFrom?.toLong(),
    progress = progress?.toProgress(),
    url = url,
    actionLabel = action?.label,
    actionUrl = action?.url,
    accentColor = accentColor,
    icon = icon,
    alert = alert,
    phase = phase,
  )
}

/** JS bridge for Android Live Updates (#966, H38, H25, H26); see LiveUpdatePoster. */
class LiveUpdatesModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("LiveUpdates")

    Function("isSupported") { LiveUpdatePoster.isSupported() }

    Function("canPostPromotedNotifications") { LiveUpdatePoster.canPostPromoted(context) }

    Function("openPromotionSettings") {
      val ctx = context
      val pkg = ctx.packageName
      val candidates = buildList {
        if (Build.VERSION.SDK_INT >= 36) {
          add(Intent(Settings.ACTION_APP_NOTIFICATION_PROMOTION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg))
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          add(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg))
        }
        add(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:$pkg")))
      }
      val launcher = appContext.currentActivity ?: ctx
      // OEM builds may drop a settings screen; fall back to the next broader one.
      val opened = candidates.any { intent ->
        try {
          launcher.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          true
        } catch (_: ActivityNotFoundException) {
          false
        }
      }
      if (!opened) throw IllegalStateException("No notification settings screen is available")
    }

    Function("show") { spec: LiveUpdateSpecRecord ->
      LiveUpdatePoster.show(context, spec.toContent())
      Unit
    }

    Function("dismiss") { id: String -> LiveUpdatePoster.dismiss(context, id) }

    Function("activeIds") {
      if (!LiveUpdatePoster.isSupported()) emptyList() else LiveUpdatePoster.activeIds(context)
    }

    // Real user dismissals since the last call (id → phase), then forgotten.
    Function("consumeDismissals") { LiveUpdateDismissals.consume(context) }
  }
}
