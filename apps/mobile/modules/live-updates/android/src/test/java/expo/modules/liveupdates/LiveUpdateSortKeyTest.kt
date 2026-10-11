package expo.modules.liveupdates

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** #966: the device rank orders the posts; sort keys compare as strings. */
class LiveUpdateSortKeyTest {
  @Test
  fun ranksSortNumerically() {
    val keys = listOf(10, 2, 0, 1).map { LiveUpdatePoster.sortKey(it)!! }
    assertEquals(listOf(0, 1, 2, 10).map { LiveUpdatePoster.sortKey(it) }, keys.sorted())
    assertTrue(LiveUpdatePoster.sortKey(0)!! < LiveUpdatePoster.sortKey(1)!!)
  }

  @Test
  fun leavesTheSystemOrderWithoutARank() {
    assertNull(LiveUpdatePoster.sortKey(null))
    assertNull(LiveUpdatePoster.sortKey(-1))
  }
}
