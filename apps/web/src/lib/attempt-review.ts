// Form-level logic for an `attempt_review`, shared by the two surfaces that
// edit one (H36 judging panel, H46 reviews overview/detail). The *rendering*
// of a single question already lives in `components/common/question-field.tsx`;
// this module holds the decisions around the form: how many required questions
// are still unanswered, how a review's status maps to a badge, and how a
// version-history `changed_fields` entry reads in human language.
//
// Deliberately NOT here: the judging panel's collaborative machinery (autosave,
// conflict detection, SSE reconciliation, judge presence). Those belong to that
// one surface. This is `lib/` rather than a route sibling because both consumers
// live in different workspaces (`judging/`, `queue/`) — the promotion rule in
// apps/web/README.md § "Where the logic module lives".

import type { AnswerValue, Question } from "@hackos/shared/questions";
import { textForDisplay } from "@/app/(app)/challenges/shared";
import type { Tone } from "@/lib/tones";

/** An answer set keyed by `question.key`, as stored in `attempt_review.scores`. */
export type ReviewAnswers = Record<string, AnswerValue | undefined>;

/**
 * Whether a stored answer counts as answered. `0` and `false` are values (a
 * 0-10 scale legitimately scores 0); an empty string or empty multi_choice
 * selection is not.
 */
export function answerHasValue(value: AnswerValue | undefined): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** How many required questions of the panel are still unanswered. */
export function requiredUnanswered(
  panel: readonly Question[] | null | undefined,
  answers: ReviewAnswers | null | undefined,
): number {
  if (!panel) return 0;
  return panel.filter((question) => question.required && !answerHasValue(answers?.[question.key]))
    .length;
}

export type ReviewStatusKind = "submitted" | "draft" | "none";

/**
 * Normalizes the API's review status. `unknown` decides where an absent or
 * unrecognised value lands: the list/detail surfaces read a nullable
 * `review_status` column where null genuinely means "never evaluated"
 * (default `"none"`), while the judging panel always has a review object —
 * `getAttemptReview` synthesizes `status: "draft"` when no row exists and the
 * column is NOT NULL DEFAULT 'draft' — and treats anything non-submitted as a
 * draft, which is what it did before this mapping was shared.
 */
export function reviewStatusKind(
  status: string | null | undefined,
  { unknown = "none" }: { unknown?: ReviewStatusKind } = {},
): ReviewStatusKind {
  if (status === "submitted") return "submitted";
  if (status === "draft") return "draft";
  return unknown;
}

export interface ReviewStatusBadge {
  kind: ReviewStatusKind;
  tone: Tone;
  /** Standalone copy key ("Evaluation submitted") — lists and page headers. */
  labelKey: "challengeReviewSubmitted" | "challengeReviewDraft" | "challengeReviewNotStarted";
  /** Terse copy key ("Submitted") — inside a card already titled "Scoring". */
  shortLabelKey: "evaluationSubmitted" | "evaluationDraft" | "challengeReviewNotStarted";
}

const REVIEW_STATUS_BADGES: Record<ReviewStatusKind, ReviewStatusBadge> = {
  submitted: {
    kind: "submitted",
    tone: "success",
    labelKey: "challengeReviewSubmitted",
    shortLabelKey: "evaluationSubmitted",
  },
  draft: {
    kind: "draft",
    tone: "info",
    labelKey: "challengeReviewDraft",
    shortLabelKey: "evaluationDraft",
  },
  none: {
    kind: "none",
    tone: "neutral",
    labelKey: "challengeReviewNotStarted",
    shortLabelKey: "challengeReviewNotStarted",
  },
};

export interface ReviewStatusBadgeOptions {
  /**
   * Tone for a draft. The judging panel passes `"warning"`: there, a draft is
   * an evaluation a judge is actively editing and the amber badge nudges them
   * to submit. The read/correct surfaces keep the default `"info"`. Whether
   * that divergence should stay is a UX call, not something this module
   * decides — see the follow-up issue linked from PR #306.
   */
  draftTone?: Tone;
  /** Where an absent/unrecognised status lands — see `reviewStatusKind`. */
  unknown?: ReviewStatusKind;
}

/** Single source for the three-way review badge (tone + copy key). */
export function reviewStatusBadge(
  status: string | null | undefined,
  { draftTone, unknown }: ReviewStatusBadgeOptions = {},
): ReviewStatusBadge {
  const badge = REVIEW_STATUS_BADGES[reviewStatusKind(status, { unknown })];
  if (draftTone && badge.kind === "draft") return { ...badge, tone: draftTone };
  return badge;
}

/** Translated names for the non-question fields a review version can touch. */
export interface ChangedFieldCopy {
  notes: string;
  status: string;
  /** Fallback when a `scores.<key>` entry no longer matches a panel question. */
  scores: string;
}

/**
 * Human label for one `attempt_review_version.changed_fields` entry:
 * `scores.<key>` resolves against the panel, `notes` / `status` are named copy.
 */
export function changedFieldLabel(
  field: string,
  panel: readonly Question[] | null | undefined,
  copy: ChangedFieldCopy,
): string {
  if (field === "notes") return copy.notes;
  if (field === "status") return copy.status;
  const key = field.startsWith("scores.") ? field.slice("scores.".length) : field;
  const question = panel?.find((candidate) => candidate.key === key);
  return question ? textForDisplay(question.label) : copy.scores;
}

/** The same, for a whole version row, ready to render. */
export function changedFieldsLabel(
  fields: readonly string[] | null | undefined,
  panel: readonly Question[] | null | undefined,
  copy: ChangedFieldCopy,
): string {
  return (fields ?? []).map((field) => changedFieldLabel(field, panel, copy)).join(", ");
}
