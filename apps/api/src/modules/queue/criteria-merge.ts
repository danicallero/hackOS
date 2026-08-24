import type { Question } from "@hackos/shared/questions";
import type { Queryable } from "../../db/pool.js";

/**
 * Judging-form unification for a shared queue (H46).
 *
 * A merged queue group has ONE judging form, not one per member challenge:
 * a judge fills exactly one form per called team regardless of which of the
 * group's challenges that team applied to. When challenges that already had
 * their own `judging_panel_criteria` are merged, their questions are folded
 * into a single canonical set stored on `queue_groups.judging_panel_criteria`
 * and handed to the admin to review/edit before the queue goes live.
 *
 * The fold is a de-duplicating union, deliberately shallow: two questions are
 * "the same question" when their keys match, or when their labels match after
 * case/whitespace/trailing-punctuation normalisation. Nothing semantic — the
 * admin review step is what catches near-misses, and guessing harder would
 * silently drop questions an enterprise wrote on purpose.
 */

/** Case-, whitespace- and trailing-punctuation-insensitive label text. */
export function normalizeQuestionText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\s.,:;!?¿¡]+$/g, "")
    .trim();
}

/**
 * Identity of a question for merge purposes: every language of its label,
 * normalised. Two questions collide when ANY language matches — an enterprise
 * that translated the same question slightly differently in one language
 * should still get one merged question, not two.
 */
function labelIdentities(question: Question): string[] {
  const label = question.label as Record<string, string> | undefined;
  if (!label) return [];
  return (["en", "es", "gl"] as const)
    .map((lang) => (typeof label[lang] === "string" ? normalizeQuestionText(label[lang]) : ""))
    .filter((text) => text.length > 0)
    .map((text) => `label:${text}`);
}

/** A key not yet taken, derived from `key` (`nota` -> `nota-2` -> `nota-3`). */
function uniqueKey(key: string, taken: Set<string>): string {
  if (!taken.has(key)) return key;
  for (let n = 2; ; n++) {
    const candidate = `${key}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export interface MergedPanel {
  questions: Question[];
  /** How many source questions were folded into an already-present one. */
  duplicatesDropped: number;
  /** Keys renamed because a different question already owned them. */
  renamedKeys: Array<{ from: string; to: string }>;
}

/**
 * Fold several challenges' panels into one, preserving author order: the
 * first panel's questions come first, then whatever the next panel adds, and
 * so on. Keys are preserved wherever possible — `attempt_review.scores` is
 * keyed by them — and only renamed when two genuinely different questions
 * claim the same key.
 */
export function mergeJudgingPanels(panels: Question[][]): MergedPanel {
  const questions: Question[] = [];
  const takenKeys = new Set<string>();
  const seenIdentities = new Set<string>();
  const renamedKeys: Array<{ from: string; to: string }> = [];
  let duplicatesDropped = 0;

  for (const panel of panels) {
    for (const question of panel) {
      const identities = labelIdentities(question);
      // A matching label in any language is the same question, whatever its
      // key. A matching key with no label to compare is taken as the same
      // question too; a matching key with a *different* label is a collision,
      // and falls through to the rename below.
      const duplicate = identities.length
        ? identities.some((id) => seenIdentities.has(id))
        : takenKeys.has(question.key);
      if (duplicate) {
        duplicatesDropped++;
        continue;
      }
      const key = uniqueKey(question.key, takenKeys);
      if (key !== question.key) renamedKeys.push({ from: question.key, to: key });
      takenKeys.add(key);
      for (const id of identities) seenIdentities.add(id);
      questions.push(key === question.key ? question : { ...question, key });
    }
  }

  return { questions, duplicatesDropped, renamedKeys };
}

function asQuestions(raw: unknown): Question[] {
  return Array.isArray(raw) ? (raw as Question[]) : [];
}

/** The member challenges' own panels, in challenge-id order. */
export async function challengePanels(
  client: Queryable,
  challengeIds: number[],
): Promise<Question[][]> {
  if (challengeIds.length === 0) return [];
  const { rows } = await client.query(
    `SELECT judging_panel_criteria FROM challenges WHERE id = ANY($1::int[]) ORDER BY id ASC`,
    [challengeIds],
  );
  return rows.map((row: { judging_panel_criteria: unknown }) =>
    asQuestions(row.judging_panel_criteria),
  );
}

/**
 * The judging form a queue entry is scored against: the group's merged panel
 * when it has one, the entry's own challenge panel otherwise. Every 1:1 group
 * takes the second branch, so single-challenge enterprises are unaffected.
 *
 * Returned untyped on purpose: pre-H44 panels are bare key strings rather
 * than catalogue questions, and `loadCriteria` still validates those
 * leniently.
 */
export async function resolveChallengePanel(
  client: Queryable,
  challengeId: number,
): Promise<unknown[]> {
  const { rows } = await client.query(
    `SELECT COALESCE(qg.judging_panel_criteria, c.judging_panel_criteria) AS criteria
       FROM challenges c
       LEFT JOIN queue_group_challenges qgc ON qgc.challenge_id = c.id
       LEFT JOIN queue_groups qg ON qg.id = qgc.queue_group_id
      WHERE c.id = $1`,
    [challengeId],
  );
  const raw = rows[0]?.criteria;
  return Array.isArray(raw) ? raw : [];
}

/** Same resolution as {@link resolveChallengePanel}, expressed as SQL. */
export const RESOLVED_PANEL_SQL = `COALESCE(
  (SELECT qg.judging_panel_criteria
     FROM queue_group_challenges qgc
     JOIN queue_groups qg ON qg.id = qgc.queue_group_id
    WHERE qgc.challenge_id = c.id),
  c.judging_panel_criteria
)`;
