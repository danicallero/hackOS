package expo.modules.liveupdates

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * #966: a countdown reaches the chip as the system's short time delta
 * (`5min`), never as an H:MM:SS chronometer; only the time since the call
 * ticks as a chronometer.
 */
class LiveUpdateWhenTest {
  private val now = 1_000_000_000L

  @Test
  fun countsDownAsTimeLeftNotAsAChronometer() {
    for (left in listOf(1_000L, 59_000L, 600_000L, 4_800_000L, 90_000_000L)) {
      assertEquals(LiveUpdatePoster.WhenStyle.TIME_LEFT, LiveUpdatePoster.whenStyle(now + left, null, now))
    }
  }

  @Test
  fun countsUpSinceTheCall() {
    assertEquals(LiveUpdatePoster.WhenStyle.COUNT_UP, LiveUpdatePoster.whenStyle(null, now - 120_000L, now))
  }

  @Test
  fun hidesAPassedCountdownOrNoInstant() {
    assertEquals(LiveUpdatePoster.WhenStyle.NONE, LiveUpdatePoster.whenStyle(now, null, now))
    assertEquals(LiveUpdatePoster.WhenStyle.NONE, LiveUpdatePoster.whenStyle(now - 1L, null, now))
    assertEquals(LiveUpdatePoster.WhenStyle.NONE, LiveUpdatePoster.whenStyle(null, null, now))
  }
}
