package expo.modules.liveupdates

import org.junit.Assert.assertEquals
import org.junit.Test

/** #966: the custom card is a fallback, never chosen when the device can promote. */
class LiveUpdatePathTest {
  @Test
  fun promotesOnAndroid16WhenAllowedAndPromotable() {
    assertEquals(LiveUpdatePoster.Path.PROMOTED, LiveUpdatePoster.choosePath(36, canPostPromoted = true, promotable = true))
    assertEquals(LiveUpdatePoster.Path.PROMOTED, LiveUpdatePoster.choosePath(37, canPostPromoted = true, promotable = true))
  }

  @Test
  fun fallsBackToTheCardOnlyWithoutPromotion() {
    assertEquals(LiveUpdatePoster.Path.CARD, LiveUpdatePoster.choosePath(35, canPostPromoted = true, promotable = true))
    assertEquals(LiveUpdatePoster.Path.CARD, LiveUpdatePoster.choosePath(36, canPostPromoted = false, promotable = true))
    assertEquals(LiveUpdatePoster.Path.CARD, LiveUpdatePoster.choosePath(36, canPostPromoted = true, promotable = false))
  }
}
