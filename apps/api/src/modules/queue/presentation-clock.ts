// #926: SET fragments shared by every write that ends or clears a presentation.

/** Folds an open timer pause into the paused total so completion keeps a clean duration. */
export const CLOSE_PRESENTATION_PAUSE_SQL = `presentation_paused_seconds = presentation_paused_seconds +
                COALESCE(GREATEST(0, EXTRACT(EPOCH FROM (now() - presentation_paused_at))), 0),
              presentation_paused_at = NULL`;

/** Clears the persisted clock when an entry leaves the room without completing. */
export const RESET_PRESENTATION_CLOCK_SQL =
  "presentation_paused_at = NULL, presentation_paused_seconds = 0, presentation_total_seconds = NULL";
