import { type Question, questionnaireSchema, validateAnswers } from "@hackos/shared/questions";
import { describe, expect, it } from "vitest";

/** Pure unit tests for the shared question catalogue (H44). No DB. */

const i18n = (t: string) => ({ en: t, es: t, gl: t });

const panel: Question[] = [
  { key: "impact", kind: "scale", label: i18n("Impact"), required: true, min: 0, max: 10 },
  { key: "works", kind: "boolean", label: i18n("Works?"), required: false },
  {
    key: "track",
    kind: "single_choice",
    label: i18n("Track"),
    required: true,
    options: [
      { value: "ai", label: i18n("AI") },
      { value: "web", label: i18n("Web") },
    ],
  },
  {
    key: "tags",
    kind: "multi_choice",
    label: i18n("Tags"),
    required: false,
    options: [
      { value: "rookie", label: i18n("Rookie") },
      { value: "green", label: i18n("Green") },
    ],
  },
  { key: "note", kind: "short_text", label: i18n("Note"), required: false, maxLength: 20 },
];

describe("questionnaireSchema", () => {
  it("applies scale defaults and accepts a valid panel", () => {
    const parsed = questionnaireSchema.parse([
      { key: "impact", kind: "scale", label: i18n("Impact") },
    ]);
    expect(parsed[0]).toMatchObject({ kind: "scale", min: 0, max: 10, required: false });
  });

  it("rejects duplicate keys", () => {
    const res = questionnaireSchema.safeParse([
      { key: "a", kind: "boolean", label: i18n("A") },
      { key: "a", kind: "boolean", label: i18n("A") },
    ]);
    expect(res.success).toBe(false);
  });

  it("rejects a scale whose max is not greater than min", () => {
    const res = questionnaireSchema.safeParse([
      { key: "a", kind: "scale", label: i18n("A"), min: 5, max: 5 },
    ]);
    expect(res.success).toBe(false);
  });

  it("accepts integer and float number fields", () => {
    const parsed = questionnaireSchema.parse([
      { key: "count", kind: "integer", label: i18n("Count"), min: 0, max: 100 },
      { key: "ratio", kind: "float", label: i18n("Ratio"), min: 0, max: 1 },
    ]);
    expect(parsed.map((q) => q.kind)).toEqual(["integer", "float"]);
  });

  it("requires choice questions to have options", () => {
    const res = questionnaireSchema.safeParse([
      { key: "a", kind: "single_choice", label: i18n("A"), options: [] },
    ]);
    expect(res.success).toBe(false);
  });
});

describe("validateAnswers", () => {
  it("passes a well-typed complete answer set on submit", () => {
    const errors = validateAnswers(
      panel,
      { impact: 7, works: true, track: "ai", tags: ["rookie"], note: "nice" },
      { requireAll: true },
    );
    expect(errors).toEqual([]);
  });

  it("flags out-of-range scale, wrong types and bad options", () => {
    const errors = validateAnswers(panel, {
      impact: 42,
      works: "yes",
      track: "nope",
      tags: ["unknown"],
      note: "way too long a note to fit",
    });
    const keys = errors.map((e) => e.key).sort();
    expect(keys).toEqual(["impact", "note", "tags", "track", "works"]);
  });

  it("validates integer and float answers", () => {
    const numberPanel: Question[] = [
      { key: "count", kind: "integer", label: i18n("Count"), required: true, min: 0, max: 10 },
      { key: "ratio", kind: "float", label: i18n("Ratio"), required: true, min: 0, max: 1 },
    ];
    expect(validateAnswers(numberPanel, { count: 3, ratio: 0.5 }, { requireAll: true })).toEqual(
      [],
    );
    expect(validateAnswers(numberPanel, { count: 3.2, ratio: 2 }).map((e) => e.key)).toEqual([
      "count",
      "ratio",
    ]);
  });

  it("rejects unknown keys", () => {
    const errors = validateAnswers(panel, { mystery: 1 });
    expect(errors.some((e) => e.key === "mystery")).toBe(true);
  });

  it("enforces required only on submit", () => {
    // Missing required `impact` + `track`: lenient off-submit, strict on submit.
    expect(validateAnswers(panel, { works: true })).toEqual([]);
    const onSubmit = validateAnswers(panel, { works: true }, { requireAll: true });
    expect(onSubmit.map((e) => e.key).sort()).toEqual(["impact", "track"]);
  });
});
