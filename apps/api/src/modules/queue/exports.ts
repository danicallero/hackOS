import { pool } from "../../db/pool.js";
import { toCsv } from "../../lib/csv.js";
import { resolveChallengePanel } from "./criteria-merge.js";
import { assertQueueChallengeReadScope } from "./fixture-scope.js";

/** H40: CSV export helpers. Plain text/csv responses, no external dep. */

export async function exportQueueCsv(challengeId: number, fixtureMarker: boolean): Promise<string> {
  await assertQueueChallengeReadScope(pool, challengeId, fixtureMarker);
  const { rows } = await pool.query(
    `SELECT qe.id, r.name AS repo_name, qe.status, qe.position, qe.priority, qe.call_count,
            qe.called_at, qe.completed_at
       FROM queue_entries qe
       JOIN repos r ON r.id = qe.repo_id AND r.is_test_account = $2
       JOIN challenges c ON c.id = qe.challenge_id AND c.is_test_account = $2
      WHERE qe.challenge_id = $1
      ORDER BY qe.position ASC NULLS LAST, qe.id ASC`,
    [challengeId, fixtureMarker],
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

export async function exportEvaluationsCsv(
  challengeId: number,
  fixtureMarker: boolean,
): Promise<string> {
  await assertQueueChallengeReadScope(pool, challengeId, fixtureMarker);
  // H46: scored against the queue group's merged form when there is one, so
  // the export's columns match the form judges actually filled.
  const raw: unknown[] = await resolveChallengePanel(pool, challengeId);
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
       JOIN repos r ON r.id = qe.repo_id AND r.is_test_account = $2
       JOIN challenges c ON c.id = qe.challenge_id AND c.is_test_account = $2
      LEFT JOIN attempt_review ar ON ar.attempt_id = qe.id
      WHERE qe.challenge_id = $1
      ORDER BY qe.position ASC NULLS LAST, qe.id ASC`,
    [challengeId, fixtureMarker],
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
