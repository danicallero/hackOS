import type { Question } from "@hackos/shared/questions";
import { describe, expect, it } from "vitest";
import { changedFieldLabel, requiredUnanswered } from "./attempt-review";

const i18n = (en: string) => ({ en, es: en, gl: en });

const panel: Question[] = [
  { key: "score", kind: "scale", label: i18n("Score"), min: 0, max: 10, required: true },
  { key: "notes_free", kind: "long_text", label: i18n("Comments"), required: false },
  { key: "tags", kind: "multi_choice", label: i18n("Tags"), required: true, options: [] },
  { key: "ship", kind: "boolean", label: i18n("Shippable"), required: true },
] as Question[];

describe("attempt review shared rules (H36, H46)", () => {
  it("counts unanswered required questions, treating 0 and false as answers", () => {
    expect(requiredUnanswered(panel, {})).toBe(3);

    // 0 on a scale and false on a boolean are real answers, not emptiness —
    // a falsy check here would wrongly block a legitimate submit.
    expect(requiredUnanswered(panel, { score: 0, tags: ["a"], ship: false })).toBe(0);

    // An empty multi_choice array is still unanswered.
    expect(requiredUnanswered(panel, { score: 5, tags: [], ship: true })).toBe(1);

    // Empty string is unanswered; optional questions never count.
    expect(requiredUnanswered(panel, { score: 5, tags: ["a"], ship: true, notes_free: "" })).toBe(
      0,
    );
  });

  it("resolves changed_fields keys to human labels", () => {
    const t = ((key: string) => key) as unknown as Parameters<typeof changedFieldLabel>[2];

    expect(changedFieldLabel("scores.score", panel, t)).toBe("Score");
    expect(changedFieldLabel("notes", panel, t)).toBe("notesLabel");
    expect(changedFieldLabel("status", panel, t)).toBe("evaluationStateLabel");

    // A question dropped from the panel since the version was written must not
    // leak its raw storage key into the history.
    expect(changedFieldLabel("scores.removed_question", panel, t)).toBe("scoring");
    expect(changedFieldLabel("scores.removed_question", panel, t)).not.toContain("removed");
  });
});
