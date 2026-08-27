import { pool } from "../../db/pool.js";
import { fixtureReadFilter } from "./review-fixture-scope.js";

/**
 * Team-wide scan history and per-staff counts (extends H22-H27): every scan
 * table already carries the actor who performed it (`check_in_logs.staff_id`,
 * `time_logs.scanned_by`, `activity_logs.logged_by`) — this reads that data,
 * it doesn't add any. Mirrors `presenceTimeline`'s subject-scoped UNION ALL
 * (presence.ts), but scoped by actor instead of subject, and across all
 * three log tables instead of two.
 */

export interface ScanLogEntry {
  id: number;
  source: "accreditation" | "door" | "activity";
  occurredAt: string;
  detail: string | null;
  subjectUserId: number;
  subjectName: string;
  subjectSurname: string;
}

export interface ScanLogPage {
  items: ScanLogEntry[];
  total: number;
}

function scanLogUnion(subjectFilter: string): string {
  return `
  SELECT cil.id, 'accreditation' AS source, cil.checked_in_at AS occurred_at,
         cil.check_in_method AS detail, u.id AS subject_user_id,
         u.name AS subject_name, u.surname AS subject_surname
    FROM check_in_logs cil JOIN users u ON u.id = cil.user_id
   WHERE cil.staff_id = $1
     AND u.account_state = 'active' AND u.anonymized_at IS NULL${subjectFilter}
  UNION ALL
  SELECT tl.id, 'door', tl.scanned_at, tl.kind, u.id, u.name, u.surname
    FROM time_logs tl JOIN users u ON u.id = tl.user_id
   WHERE tl.scanned_by = $1
     AND u.account_state = 'active' AND u.anonymized_at IS NULL${subjectFilter}
  UNION ALL
  SELECT al.id, 'activity', al.logged_at, a.name, u.id, u.name, u.surname
    FROM activity_logs al
    JOIN activities a ON a.id = al.activity_id
    JOIN users u ON u.id = al.user_id
   WHERE al.logged_by = $1
     AND u.account_state = 'active' AND u.anonymized_at IS NULL${subjectFilter}
`;
}

/** Paginated scan-log feed for one staff member, most recent first. */
export async function queryScanLog(
  staffId: number,
  limit: number,
  offset: number,
): Promise<ScanLogPage> {
  const subjectFilter = await fixtureReadFilter(pool, staffId, "u");
  const union = scanLogUnion(subjectFilter);
  const [{ rows }, { rows: countRows }] = await Promise.all([
    pool.query(
      `SELECT * FROM (${union}) log ORDER BY occurred_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [staffId, limit, offset],
    ),
    pool.query(`SELECT count(*)::int AS count FROM (${union}) log`, [staffId]),
  ]);
  return {
    items: rows.map((r) => ({
      id: Number(r.id),
      source: r.source as ScanLogEntry["source"],
      occurredAt: (r.occurred_at as Date).toISOString(),
      detail: (r.detail as string | null) ?? null,
      subjectUserId: Number(r.subject_user_id),
      subjectName: (r.subject_name as string | null) ?? "",
      subjectSurname: (r.subject_surname as string | null) ?? "",
    })),
    total: countRows[0].count as number,
  };
}

export interface StaffScanCounts {
  accreditationCount: number;
  presenceCount: number;
  activityCount: number;
}

/** Counts of scans a single staff member performed, by domain. */
export async function staffScanCounts(staffId: number): Promise<StaffScanCounts> {
  const subjectFilter = await fixtureReadFilter(pool, staffId, "u");
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*)::int
         FROM check_in_logs cil JOIN users u ON u.id = cil.user_id
         WHERE cil.staff_id = $1 AND u.account_state = 'active' AND u.anonymized_at IS NULL
           ${subjectFilter || "AND u.is_test_account = false"}) AS accreditation_count,
       (SELECT count(*)::int
         FROM time_logs tl JOIN users u ON u.id = tl.user_id
         WHERE tl.scanned_by = $1 AND u.account_state = 'active' AND u.anonymized_at IS NULL
           ${subjectFilter || "AND u.is_test_account = false"}) AS presence_count,
       (SELECT count(*)::int
         FROM activity_logs al JOIN users u ON u.id = al.user_id
         WHERE al.logged_by = $1 AND u.account_state = 'active' AND u.anonymized_at IS NULL
           ${subjectFilter || "AND u.is_test_account = false"}) AS activity_count`,
    [staffId],
  );
  return {
    accreditationCount: rows[0].accreditation_count as number,
    presenceCount: rows[0].presence_count as number,
    activityCount: rows[0].activity_count as number,
  };
}

export interface StaffScanRankingRow extends StaffScanCounts {
  staffId: number;
  name: string;
  surname: string;
  total: number;
}

/** Ranking of every staff member who performed at least one scan, busiest first. */
export async function staffScanRanking(): Promise<StaffScanRankingRow[]> {
  const { rows } = await pool.query(
    `WITH staff_ids AS (
       SELECT DISTINCT staff_id AS id FROM check_in_logs
       UNION
       SELECT DISTINCT scanned_by FROM time_logs WHERE scanned_by IS NOT NULL
       UNION
       SELECT DISTINCT logged_by FROM activity_logs
     ), counted AS (
       SELECT u.id AS staff_id, u.name, u.surname,
              (SELECT count(*)::int
                 FROM check_in_logs cil JOIN users subject ON subject.id = cil.user_id
                WHERE cil.staff_id = u.id AND subject.account_state = 'active' AND subject.anonymized_at IS NULL
                  AND subject.is_test_account = false) AS accreditation_count,
              (SELECT count(*)::int
                 FROM time_logs tl JOIN users subject ON subject.id = tl.user_id
                WHERE tl.scanned_by = u.id AND subject.account_state = 'active' AND subject.anonymized_at IS NULL
                  AND subject.is_test_account = false) AS presence_count,
              (SELECT count(*)::int
                 FROM activity_logs al JOIN users subject ON subject.id = al.user_id
                WHERE al.logged_by = u.id AND subject.account_state = 'active' AND subject.anonymized_at IS NULL
                  AND subject.is_test_account = false) AS activity_count
         FROM staff_ids si
         JOIN users u ON u.id = si.id
          AND u.account_state = 'active' AND u.anonymized_at IS NULL AND u.is_test_account = false
     )
     SELECT *
       FROM counted
      ORDER BY (accreditation_count + presence_count + activity_count) DESC, surname ASC, name ASC`,
  );
  return rows.map((r) => {
    const accreditationCount = r.accreditation_count as number;
    const presenceCount = r.presence_count as number;
    const activityCount = r.activity_count as number;
    return {
      staffId: Number(r.staff_id),
      name: (r.name as string | null) ?? "",
      surname: (r.surname as string | null) ?? "",
      accreditationCount,
      presenceCount,
      activityCount,
      total: accreditationCount + presenceCount + activityCount,
    };
  });
}
