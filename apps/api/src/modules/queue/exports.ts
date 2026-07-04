import { pool } from "../../db/pool.js";

/** H40: CSV export helpers. Plain text/csv responses, no external dep. */

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header.join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

export async function exportQueueCsv(challengeId: number): Promise<string> {
  const { rows } = await pool.query(
    `SELECT qe.id, r.name AS repo_name, qe.status, qe.position, qe.priority, qe.call_count,
            qe.called_at, qe.completed_at
       FROM queue_entries qe
       JOIN repos r ON r.id = qe.repo_id
      WHERE qe.challenge_id = $1
      ORDER BY qe.position ASC NULLS LAST, qe.id ASC`,
    [challengeId],
  );
  const header = [
    "id",
    "repo_name",
    "status",
    "position",
    "priority",
    "call_count",
    "called_at",
    "completed_at",
  ];
  return toCsv(
    header,
    rows.map((r: Record<string, unknown>) => header.map((h) => r[h])),
  );
}

export async function exportEvaluationsCsv(challengeId: number): Promise<string> {
  const challenge = (
    await pool.query(`SELECT judging_panel_criteria FROM challenges WHERE id = $1`, [challengeId])
  ).rows[0];
  const raw: unknown[] = Array.isArray(challenge?.judging_panel_criteria)
    ? challenge.judging_panel_criteria
    : [];
  // One column per criterion (H40); accept both string and {key} shapes.
  const criteria = raw
    .map((c) =>
      typeof c === "string"
        ? c
        : c && typeof c === "object"
          ? (c as { key?: unknown }).key
          : undefined,
    )
    .filter((k): k is string => typeof k === "string")
    .map((key) => ({ key }));

  const { rows } = await pool.query(
    `SELECT r.name AS repo_name, ar.status, ar.notes, ar.scores
       FROM queue_entries qe
       JOIN repos r ON r.id = qe.repo_id
       LEFT JOIN attempt_review ar ON ar.attempt_id = qe.id
      WHERE qe.challenge_id = $1
      ORDER BY qe.position ASC NULLS LAST, qe.id ASC`,
    [challengeId],
  );

  const header = ["repo_name", "status", ...criteria.map((c) => c.key), "notes"];
  return toCsv(
    header,
    rows.map(
      (r: {
        repo_name: string;
        status: string | null;
        notes: string | null;
        scores: Record<string, unknown> | null;
      }) => [
        r.repo_name,
        r.status ?? "not_evaluated",
        ...criteria.map((c) => r.scores?.[c.key] ?? ""),
        r.notes ?? "",
      ],
    ),
  );
}
