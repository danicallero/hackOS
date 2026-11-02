import { describe, expect, it } from "vitest";
import { answerValues, hasDietaryRestrictions } from "./response-filters";

describe("response answer filters (H13)", () => {
  it("preserves exact choices, false, zero and historical numeric IDs", () => {
    expect(answerValues(["a", "ab", 42])).toEqual(["a", "ab", "42"]);
    expect(answerValues(false)).toEqual(["false"]);
    expect(answerValues(0)).toEqual(["0"]);
    expect(answerValues(null)).toEqual([]);
    expect(answerValues([])).toEqual([]);
    expect(answerValues({ city: "A Coruña", country: "Spain" })).toEqual(["A Coruña, Spain"]);
  });
  it("includes notes-only dietary restrictions and ignores empty notes", () => {
    expect(
      hasDietaryRestrictions({ food_intolerances: [], food_intolerance_notes: "allergy" }),
    ).toBe(true);
    expect(hasDietaryRestrictions({ food_intolerances: [1], food_intolerance_notes: null })).toBe(
      true,
    );
    expect(hasDietaryRestrictions({ food_intolerances: [], food_intolerance_notes: "  " })).toBe(
      false,
    );
  });
});
