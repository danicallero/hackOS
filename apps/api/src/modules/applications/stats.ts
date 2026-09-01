import { pool } from "../../db/pool.js";
import { NotFoundError } from "../../lib/errors.js";
import { requireApplication } from "./service.js";

/**
 * Pre-event statistics (H27, capability LOGISTICS_STATS). Counts by status,
 * the confirmation funnel, submission/confirmation time series (per day, per
 * hour-of-day, per day-of-week), time-to-confirm summary, an optional
 * template-field histogram, and shirt-size / food-intolerance distributions.
 *
 * Sensitive rule (H27): shirt sizes and food intolerances count ONLY users
 * who CONFIRMED — non-confirmed applicants' logistics data must not surface
 * in aggregate stats even though it's kept on the user row.
 */

interface Counts {
  [status: string]: number;
}

export async function applicationStats(
  applicationId: number,
  field?: string,
): Promise<Record<string, unknown>> {
  const app = await requireApplication(pool, applicationId);
  // H8: the retired static `type` is replaced by the name of the form's
  // highest-position granted role — derived from grants_role_ids so it can
  // never drift from what the form actually grants.
  const { rows: grantedRoleRows } = await pool.query(
    `SELECT r.name AS granted_role_name
       FROM application_grants_roles agr
       JOIN roles r ON r.id = agr.role_id AND r.deleted_at IS NULL
      WHERE agr.application_id = $1
      ORDER BY r.position DESC
      LIMIT 1`,
    [applicationId],
  );
  const grantedRoleName = (grantedRoleRows[0]?.granted_role_name as string | undefined) ?? null;

  const statusCounts = await pool.query(
    `SELECT r.status, count(*)::int AS n FROM application_responses r
     JOIN users u ON u.id = r.user_id AND u.account_state = 'active' AND u.anonymized_at IS NULL AND u.is_test_account = false
     WHERE r.application_id = $1 GROUP BY r.status`,
    [applicationId],
  );
  const byStatus: Counts = {};
  for (const r of statusCounts.rows as Array<{ status: string; n: number }>) {
    byStatus[r.status] = r.n;
  }

  // Funnel among sent decisions (H27): sent, still-in-window, expired, declined, confirmed.
  const funnel = await pool.query(
    `SELECT
       count(*) FILTER (WHERE r.decision_sent_at IS NOT NULL AND r.status IN ('accepted','confirmed','declined','expired'))::int AS sent,
       count(*) FILTER (WHERE r.status = 'accepted' AND r.decision_sent_at IS NOT NULL)::int AS still_in_window,
       count(*) FILTER (WHERE r.status = 'expired')::int AS expired,
       count(*) FILTER (WHERE r.status = 'declined')::int AS declined,
       count(*) FILTER (WHERE r.status = 'confirmed')::int AS confirmed
     FROM application_responses r
     JOIN users u ON u.id = r.user_id AND u.account_state = 'active' AND u.anonymized_at IS NULL AND u.is_test_account = false
     WHERE r.application_id = $1`,
    [applicationId],
  );

  // Time series of submissions and confirmations (anonymized applicants excluded).
  const submissionsByDay = await pool.query(
    `SELECT to_char(date_trunc('day', r.submitted_at), 'YYYY-MM-DD') AS bucket, count(*)::int AS n
     FROM application_responses r
     JOIN users u ON u.id = r.user_id AND u.account_state = 'active' AND u.anonymized_at IS NULL AND u.is_test_account = false
     WHERE r.application_id = $1 AND r.submitted_at IS NOT NULL
     GROUP BY bucket ORDER BY bucket`,
    [applicationId],
  );
  const confirmationsByDay = await pool.query(
    `SELECT to_char(date_trunc('day', r.confirmed_at), 'YYYY-MM-DD') AS bucket, count(*)::int AS n
     FROM application_responses r
     JOIN users u ON u.id = r.user_id AND u.account_state = 'active' AND u.anonymized_at IS NULL AND u.is_test_account = false
     WHERE r.application_id = $1 AND r.confirmed_at IS NOT NULL
     GROUP BY bucket ORDER BY bucket`,
    [applicationId],
  );
  const submissionsByHour = await pool.query(
    `SELECT extract(hour FROM r.submitted_at)::int AS hour, count(*)::int AS n
     FROM application_responses r
     JOIN users u ON u.id = r.user_id AND u.account_state = 'active' AND u.anonymized_at IS NULL AND u.is_test_account = false
     WHERE r.application_id = $1 AND r.submitted_at IS NOT NULL
     GROUP BY hour ORDER BY hour`,
    [applicationId],
  );
  const submissionsByDow = await pool.query(
    `SELECT extract(dow FROM r.submitted_at)::int AS dow, count(*)::int AS n
     FROM application_responses r
     JOIN users u ON u.id = r.user_id AND u.account_state = 'active' AND u.anonymized_at IS NULL AND u.is_test_account = false
     WHERE r.application_id = $1 AND r.submitted_at IS NOT NULL
     GROUP BY dow ORDER BY dow`,
    [applicationId],
  );

  // Hours from decision_sent_at to confirmed_at: avg + median.
  const timeToConfirm = await pool.query(
    `SELECT
       avg(extract(epoch FROM (confirmed_at - decision_sent_at)) / 3600.0) AS avg_hours,
       percentile_cont(0.5) WITHIN GROUP
         (ORDER BY extract(epoch FROM (confirmed_at - decision_sent_at)) / 3600.0) AS median_hours
     FROM application_responses r
     JOIN users u ON u.id = r.user_id
     WHERE r.application_id = $1 AND r.confirmed_at IS NOT NULL AND r.decision_sent_at IS NOT NULL
       AND u.account_state = 'active' AND u.anonymized_at IS NULL AND u.is_test_account = false`,
    [applicationId],
  );

  // Confirmed-only logistics distributions (H27 sensitive rule).
  const shirtSizes = await pool.query(
    `SELECT u.shirt_size AS value, count(*)::int AS n
     FROM application_responses r JOIN users u ON u.id = r.user_id
     WHERE r.application_id = $1 AND r.status = 'confirmed' AND u.shirt_size IS NOT NULL
       AND u.account_state = 'active' AND u.anonymized_at IS NULL AND u.is_test_account = false
     GROUP BY u.shirt_size ORDER BY n DESC`,
    [applicationId],
  );

  const intolerances = await pool.query(
    `SELECT fi.id AS intolerance_id, fi.label,
            count(*)::int AS n
     FROM application_responses r
     JOIN users u ON u.id = r.user_id
     JOIN LATERAL unnest(u.food_intolerances) AS uid(id) ON true
     JOIN food_intolerances fi ON fi.id = uid.id
     WHERE r.application_id = $1 AND r.status = 'confirmed' AND u.account_state = 'active' AND u.anonymized_at IS NULL AND u.is_test_account = false
     GROUP BY fi.id, fi.label ORDER BY n DESC`,
    [applicationId],
  );

  const result: Record<string, unknown> = {
    application: {
      id: app.id,
      name: app.name,
      granted_role_name: grantedRoleName,
      capacity: app.capacity,
    },
    counts_by_status: byStatus,
    funnel: funnel.rows[0],
    time_series: {
      submissions_by_day: submissionsByDay.rows,
      confirmations_by_day: confirmationsByDay.rows,
      submissions_by_hour_of_day: submissionsByHour.rows,
      submissions_by_day_of_week: submissionsByDow.rows,
    },
    time_to_confirm_hours: {
      avg: toNum(timeToConfirm.rows[0]?.avg_hours),
      median: toNum(timeToConfirm.rows[0]?.median_hours),
    },
    shirt_sizes_confirmed: shirtSizes.rows,
    food_intolerances_confirmed: intolerances.rows,
  };

  if (field) {
    result.field_histogram = await fieldHistogram(applicationId, app.template, field);
  }

  return result;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return Number(v);
}

/**
 * Value histogram for one template field across all responses. Multiselect
 * values are exploded so each chosen option counts once. Field must exist in
 * the template.
 */
async function fieldHistogram(
  applicationId: number,
  template: Array<{ key: string; kind: string }>,
  field: string,
): Promise<{ field: string; buckets: Array<{ value: string; n: number }> }> {
  const def = template.find((f) => f.key === field);
  if (!def) throw new NotFoundError(`Template field "${field}" not found`, { field });

  const isMulti = def.kind === "multiselect";
  const { rows } = isMulti
    ? await pool.query(
        `SELECT elem AS value, count(*)::int AS n
         FROM application_responses r
         JOIN users u ON u.id = r.user_id
         JOIN LATERAL jsonb_array_elements_text(
                CASE WHEN jsonb_typeof(r.responses -> $2) = 'array'
                     THEN r.responses -> $2 ELSE '[]'::jsonb END) AS elem ON true
         WHERE r.application_id = $1
           AND u.account_state = 'active' AND u.anonymized_at IS NULL AND u.is_test_account = false
         GROUP BY elem ORDER BY n DESC`,
        [applicationId, field],
      )
    : await pool.query(
        `SELECT (r.responses ->> $2) AS value, count(*)::int AS n
         FROM application_responses r
         JOIN users u ON u.id = r.user_id
         WHERE r.application_id = $1 AND r.responses ? $2
           AND u.account_state = 'active' AND u.anonymized_at IS NULL AND u.is_test_account = false
         GROUP BY value ORDER BY n DESC`,
        [applicationId, field],
      );
  return { field, buckets: rows };
}
