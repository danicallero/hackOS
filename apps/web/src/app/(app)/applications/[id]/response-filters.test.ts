import { describe, expect, it } from "vitest";
import {
  answerValues,
  hasDietaryRestrictions,
  matchesResponseSearch,
  matchesScore,
} from "./response-filters";

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

describe("score selection (H13/H14)", () => {
  it("supports strict comparisons, exact equality, zero and decimal averages", () => {
    expect(matchesScore("7.5", "gt", 7)).toBe(true);
    expect(matchesScore(7, "gt", 7)).toBe(false);
    expect(matchesScore("6.9", "lt", 7)).toBe(true);
    expect(matchesScore(7, "lt", 7)).toBe(false);
    expect(matchesScore("7.5", "eq", 7.5)).toBe(true);
    expect(matchesScore(7.51, "eq", 7.5)).toBe(false);
    expect(matchesScore(0, "eq", 0)).toBe(true);
    expect(matchesScore(0, "lt", 1)).toBe(true);
  });
  it("excludes missing and invalid scores and thresholds", () => {
    for (const score of [null, "", "NaN", "Infinity"]) {
      expect(matchesScore(score, "lt", 10)).toBe(false);
    }
    expect(matchesScore(5, "gt", Number.NaN)).toBe(false);
    expect(matchesScore(5, "lt", Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("response search (H13)", () => {
  const row = {
    name: "Ada Lovelace",
    email: "ada@example.test",
    reviews: [
      {
        author_id: 1,
        author_name: "Reviewer",
        score: 8,
        notes: "Excellent robotics experience",
        updated_at: "2026-11-03",
      },
    ],
  };
  it("matches names, emails and permitted review notes without case sensitivity", () => {
    for (const query of [" ADA ", "example.test", " ROBOTICS ", ""]) {
      expect(matchesResponseSearch(row, query)).toBe(true);
    }
    expect(matchesResponseSearch(row, "unrelated")).toBe(false);
  });
  it("does not match notes absent from the API's permitted reviews", () => {
    expect(matchesResponseSearch({ ...row, reviews: [] }, "robotics")).toBe(false);
    expect(
      matchesResponseSearch({ ...row, reviews: [{ ...row.reviews[0], notes: null }] }, "robotics"),
    ).toBe(false);
  });
});
