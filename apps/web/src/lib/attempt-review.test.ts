import type { Question } from "@hackos/shared/questions";
import { describe, expect, it } from "vitest";
import {
  answerHasValue,
  changedFieldLabel,
  changedFieldsLabel,
  requiredUnanswered,
  reviewStatusBadge,
  reviewStatusKind,
} from "./attempt-review";

const label = (en: string) => ({ en, es: en, gl: en });

const PANEL: Question[] = [
  { kind: "scale", key: "impact", label: label("Impact"), required: true, min: 0, max: 10 },
  { kind: "long_text", key: "why", label: label("Why"), required: true, maxLength: 2000 },
  { kind: "short_text", key: "extra", label: label("Extra"), required: false, maxLength: 200 },
  {
    kind: "multi_choice",
    key: "tracks",
    label: label("Tracks"),
    required: true,
    options: [
      { value: "ai", label: label("AI") },
      { value: "web", label: label("Web") },
    ],
  },
];

const COPY = { notes: "Notes", status: "Evaluation state", scores: "Scoring" };

describe("answerHasValue", () => {
  it("treats 0 and false as answered but empty string/array as unanswered", () => {
    expect(answerHasValue(0)).toBe(true);
    expect(answerHasValue(false)).toBe(true);
    expect(answerHasValue(["ai"])).toBe(true);
    expect(answerHasValue("")).toBe(false);
    expect(answerHasValue([])).toBe(false);
    expect(answerHasValue(undefined)).toBe(false);
  });
});

describe("requiredUnanswered", () => {
  it("counts only required questions", () => {
    expect(requiredUnanswered(PANEL, {})).toBe(3);
    // `extra` is optional: leaving it blank never blocks submission.
    expect(requiredUnanswered(PANEL, { impact: 5, why: "good", tracks: ["ai"] })).toBe(0);
    expect(requiredUnanswered(PANEL, { impact: 5, why: "good", tracks: ["ai"], extra: "" })).toBe(
      0,
    );
  });

  it("counts an empty multi_choice selection as unanswered", () => {
    expect(requiredUnanswered(PANEL, { impact: 5, why: "good", tracks: [] })).toBe(1);
  });

  it("accepts 0 as a valid scale answer", () => {
    expect(requiredUnanswered(PANEL, { impact: 0, why: "good", tracks: ["web"] })).toBe(0);
    expect(requiredUnanswered(PANEL, { impact: "", why: "good", tracks: ["web"] })).toBe(1);
  });

  it("is safe with an absent panel or absent answers", () => {
    expect(requiredUnanswered(null, {})).toBe(0);
    expect(requiredUnanswered([], undefined)).toBe(0);
    expect(requiredUnanswered(PANEL, undefined)).toBe(3);
  });
});

describe("reviewStatusBadge", () => {
  it("maps the three review states", () => {
    expect(reviewStatusKind("submitted")).toBe("submitted");
    expect(reviewStatusKind("draft")).toBe("draft");
    expect(reviewStatusKind(null)).toBe("none");
    expect(reviewStatusKind("something-else")).toBe("none");

    expect(reviewStatusBadge("submitted")).toMatchObject({
      tone: "success",
      labelKey: "challengeReviewSubmitted",
      shortLabelKey: "evaluationSubmitted",
    });
    expect(reviewStatusBadge("draft")).toMatchObject({
      tone: "info",
      labelKey: "challengeReviewDraft",
    });
    expect(reviewStatusBadge(undefined)).toMatchObject({
      tone: "neutral",
      labelKey: "challengeReviewNotStarted",
      shortLabelKey: "challengeReviewNotStarted",
    });
  });

  // The judging panel opts into both of its pre-existing behaviors rather than
  // inheriting the reviews surfaces' defaults.
  it("honours the judging panel's draftTone override", () => {
    expect(reviewStatusBadge("draft", { draftTone: "warning" }).tone).toBe("warning");
    // Only a draft is re-toned; submitted and none keep theirs.
    expect(reviewStatusBadge("submitted", { draftTone: "warning" }).tone).toBe("success");
    expect(reviewStatusBadge(null, { draftTone: "warning" }).tone).toBe("neutral");
  });

  it("honours an `unknown: draft` fallback for surfaces that always have a review", () => {
    expect(reviewStatusKind(null, { unknown: "draft" })).toBe("draft");
    expect(reviewStatusKind("weird-value", { unknown: "draft" })).toBe("draft");
    expect(reviewStatusKind("submitted", { unknown: "draft" })).toBe("submitted");

    const badge = reviewStatusBadge(null, { draftTone: "warning", unknown: "draft" });
    expect(badge).toMatchObject({
      kind: "draft",
      tone: "warning",
      shortLabelKey: "evaluationDraft",
    });
  });
});

describe("changedFieldLabel", () => {
  it("resolves scores.<key> to the question label", () => {
    expect(changedFieldLabel("scores.impact", PANEL, COPY)).toBe("Impact");
    expect(changedFieldLabel("impact", PANEL, COPY)).toBe("Impact");
  });

  it("names the non-question fields", () => {
    expect(changedFieldLabel("notes", PANEL, COPY)).toBe("Notes");
    expect(changedFieldLabel("status", PANEL, COPY)).toBe("Evaluation state");
  });

  it("falls back when the question is gone from the panel", () => {
    expect(changedFieldLabel("scores.removed", PANEL, COPY)).toBe("Scoring");
    expect(changedFieldLabel("scores.removed", null, COPY)).toBe("Scoring");
  });

  it("joins a whole changed_fields row", () => {
    expect(changedFieldsLabel(["scores.impact", "notes", "status"], PANEL, COPY)).toBe(
      "Impact, Notes, Evaluation state",
    );
    expect(changedFieldsLabel(undefined, PANEL, COPY)).toBe("");
  });
});
