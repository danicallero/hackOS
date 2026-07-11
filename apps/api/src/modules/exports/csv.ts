import { pool } from "../../db/pool.js";
import { toCsv } from "../../lib/csv.js";

/** H54: operational CSV exports, staff-wide (not scoped to one subject). */

export async function exportAttendanceCsv(): Promise<string> {
  const { rows } = await pool.query(
    `SELECT u.id AS user_id, u.name, u.surname, u.email,
            'check_in' AS event, cil.checked_in_at AS occurred_at,
            cil.check_in_method AS method, cil.staff_id AS logged_by
       FROM check_in_logs cil JOIN users u ON u.id = cil.user_id
      UNION ALL
     SELECT u.id, u.name, u.surname, u.email,
            tl.kind, tl.scanned_at, NULL::text, tl.scanned_by
       FROM time_logs tl JOIN users u ON u.id = tl.user_id
      ORDER BY occurred_at`,
  );
  const header = [
    "user_id",
    "name",
    "surname",
    "email",
    "event",
    "occurred_at",
    "method",
    "logged_by",
  ];
  return toCsv(
    header,
    rows.map((r: Record<string, unknown>) => header.map((h) => r[h])),
  );
}

export async function exportMealsCsv(): Promise<string> {
  const { rows } = await pool.query(
    `SELECT u.id AS user_id, u.name, u.surname, u.email,
            a.name AS meal_name, al.logged_at, al.logged_by, al.notes
       FROM activity_logs al
       JOIN activities a ON a.id = al.activity_id
       JOIN users u ON u.id = al.user_id
      WHERE a.category = 'meal'
      ORDER BY al.logged_at`,
  );
  const header = [
    "user_id",
    "name",
    "surname",
    "email",
    "meal_name",
    "logged_at",
    "logged_by",
    "notes",
  ];
  return toCsv(
    header,
    rows.map((r: Record<string, unknown>) => header.map((h) => r[h])),
  );
}

export async function exportApplicationsCsv(applicationId?: number): Promise<string> {
  const { rows } = await pool.query(
    `SELECT ar.id AS response_id, u.id AS user_id, u.name, u.surname, u.email,
            app.name AS application_name, app.type AS application_type,
            ar.status, ar.submitted_at, ar.confirmed_at, ar.declined_at,
            (SELECT AVG(score) FROM applicant_reviews WHERE response_id = ar.id) AS avg_score
       FROM application_responses ar
       JOIN applications app ON app.id = ar.application_id
       JOIN users u ON u.id = ar.user_id
      WHERE $1::int IS NULL OR ar.application_id = $1
      ORDER BY ar.id`,
    [applicationId ?? null],
  );
  const header = [
    "response_id",
    "user_id",
    "name",
    "surname",
    "email",
    "application_name",
    "application_type",
    "status",
    "submitted_at",
    "confirmed_at",
    "declined_at",
    "avg_score",
  ];
  return toCsv(
    header,
    rows.map((r: Record<string, unknown>) => header.map((h) => r[h])),
  );
}
