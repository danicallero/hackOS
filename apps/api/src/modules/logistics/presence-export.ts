import { pool } from "../../db/pool.js";
import { recordsToCsv, toCsv } from "../../lib/csv.js";
import { allHours, hoursWithBreakdown } from "./presence.js";

/** H24/H54: reduced hours export — one row per participant, no breakdown. */
const REDUCED_HEADER = ["user_id", "name", "surname", "email", "dni", "hours"];

/**
 * H24/H54: full hours export — one `summary` row per participant (mirrors
 * the reduced shape) followed by one `detail` row per presence window,
 * including ones that expired with no confirming signal (`expired=true`,
 * `time_aggregated=0`). Kept as a single flat table (rather than nested
 * sections) so it stays valid, tool-openable CSV; `row_type` and the blank
 * summary/detail-only columns tell the two kinds of row apart.
 */
const FULL_HEADER = [
  "row_type",
  "user_id",
  "name",
  "surname",
  "email",
  "dni",
  "hours",
  "activity",
  "time_logged_in",
  "time_logged_out",
  "confirmed",
  "expired",
  "time_aggregated",
];

async function contactFieldsById(
  userIds: number[],
): Promise<Map<number, { email: string; dni: string | null }>> {
  if (userIds.length === 0) return new Map();
  const { rows } = await pool.query(`SELECT id, email, dni FROM users WHERE id = ANY($1)`, [
    userIds,
  ]);
  return new Map(
    (rows as { id: number; email: string; dni: string | null }[]).map((r) => [
      r.id,
      { email: r.email, dni: r.dni },
    ]),
  );
}

export interface HoursExportOptions {
  format: "reduced" | "full";
  minHours?: number;
  userIds?: number[];
  actorId?: number;
}

/** Bulk hours CSV for the presence Hours tab (H24/H54). */
export async function exportHoursCsv(options: HoursExportOptions): Promise<string> {
  const { format, minHours, userIds, actorId } = options;

  if (format === "reduced") {
    const rows = (await allHours(undefined, actorId)).filter(
      (r) => userIds == null || userIds.includes(r.userId),
    );
    const filtered = minHours == null ? rows : rows.filter((r) => r.hours >= minHours);
    const contact = await contactFieldsById(filtered.map((r) => r.userId));
    return toCsv(
      REDUCED_HEADER,
      recordsToCsv(
        REDUCED_HEADER,
        filtered.map((r) => ({
          user_id: r.userId,
          name: r.name,
          surname: r.surname,
          email: contact.get(r.userId)?.email ?? null,
          dni: contact.get(r.userId)?.dni ?? null,
          hours: r.hours,
        })),
      ),
    );
  }

  const people = await hoursWithBreakdown(userIds, undefined, actorId);
  const filtered = minHours == null ? people : people.filter((p) => p.hours >= minHours);
  const contact = await contactFieldsById(filtered.map((p) => p.userId));
  const rows: Record<string, unknown>[] = [];
  for (const p of filtered) {
    rows.push({
      row_type: "summary",
      user_id: p.userId,
      name: p.name,
      surname: p.surname,
      email: contact.get(p.userId)?.email ?? null,
      dni: p.dni,
      hours: p.hours,
      activity: null,
      time_logged_in: null,
      time_logged_out: null,
      confirmed: null,
      expired: null,
      time_aggregated: null,
    });
    for (const interval of p.intervals) {
      rows.push({
        row_type: "detail",
        user_id: p.userId,
        name: null,
        surname: null,
        email: null,
        dni: null,
        hours: null,
        activity: interval.activity,
        time_logged_in: interval.start,
        time_logged_out: interval.end,
        confirmed: interval.confirmed,
        expired: interval.expired,
        time_aggregated: interval.contributedHours,
      });
    }
  }
  return toCsv(FULL_HEADER, recordsToCsv(FULL_HEADER, rows));
}
