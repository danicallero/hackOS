/**
 * Evaluation (`attempt_review`) rules shared by the two surfaces that render
 * one: the live judging panel (H36) and the reviews-overview detail (H46).
 *
 * Only the rules both surfaces genuinely agree on live here. The judging
 * panel's collaborative machinery — autosave, conflict reconciliation, judge
 * presence, offline state — is deliberately NOT shared: the overview is a
 * single-editor surface and unifying the two would mean threading a `mode`
 * flag through every branch of both.
 */

import type { Question } from "@hackos/shared/questions";
import { textForDisplay } from "@/app/(app)/challenges/shared";
import { type Answers, answerHasValue } from "@/components/common/question-field";
import type { Translate } from "@/lib/i18n";

/**
 * How many required questions are still unanswered. Drives the submit gate:
 * the API enforces the same rule on submit (`validateAnswers(…, requireAll)`),
 * this is the client-side affordance.
 *
 * Note `0` is a valid scale answer — emptiness is decided by
 * `answerHasValue`, never by falsiness.
 */
export function requiredUnanswered(panel: Question[], answers: Answers): number {
  return panel.filter((question) => question.required && !answerHasValue(answers[question.key]))
    .length;
}

/**
 * Human label for an `attempt_review_versions.changed_fields` entry.
 *
 * Rows store `scores.<question key>`, `notes` or `status`. Rendering the raw
 * value leaks internal keys into the version history, so resolve it against
 * the challenge's panel; fall back to a generic label for a question that has
 * since been removed from the panel.
 */
export function changedFieldLabel(field: string, panel: Question[], t: Translate): string {
  if (field === "notes") return t("notesLabel");
  if (field === "status") return t("evaluationStateLabel");
  const key = field.startsWith("scores.") ? field.slice("scores.".length) : field;
  const question = panel.find((candidate) => candidate.key === key);
  return question ? textForDisplay(question.label) : t("scoring");
}
