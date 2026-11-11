import type { AttendanceKind } from "@hackos/shared/onboarding";
import { pool, type Queryable } from "../../db/pool.js";

/** Participant evidence wins over mentor, sponsor and staff evidence. */
export async function attendanceKind(
  db: Queryable = pool,
  userId: number,
): Promise<AttendanceKind | null> {
  const { rows } = await db.query<{ kind: AttendanceKind | null }>(
    `SELECT kind FROM event_attendance_kinds WHERE user_id = $1
       AND event_key = (SELECT event_key FROM event_config WHERE id = 1)`,
    [userId],
  );
  return rows[0]?.kind ?? null;
}
