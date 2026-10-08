import { describe, expect, it } from "vitest";
import { matchingQueries, rankMatchingUsers, searchableIdentity } from "./identity-matches";

describe("unmatched identity suggestions (H17)", () => {
  const person = { name: "María", surname: "López", email: "maria@devpost.test" };
  const sameName = { id: 1, name: "Maria", surname: "Lopez", email: "ml@platform.test" };
  const sameHandle = { id: 2, name: "Other", surname: null, email: "maria@platform.test" };
  const unrelated = { id: 3, name: "Maria", surname: "Other", email: "different@platform.test" };

  it("orders accent-insensitive complete names above email handles without suggesting first names alone", () => {
    expect(rankMatchingUsers(person, [unrelated, sameHandle, sameName], true)).toEqual([
      sameName,
      sameHandle,
    ]);
  });
  it("keeps unrelated manual search results available", () => {
    expect(rankMatchingUsers(person, [unrelated])).toEqual([unrelated]);
  });
  it("does not suggest accounts from empty names or short email handles", () => {
    expect(
      rankMatchingUsers(
        { name: null, surname: null, email: "a@external.test" },
        [{ ...unrelated, email: "a@platform.test" }],
        true,
      ),
    ).toEqual([]);
    expect(matchingQueries({ name: "", surname: null, email: "a@external.test" })).toEqual([]);
  });
  it("normalizes accents, case and spaces for the bounded list search", () => {
    expect(searchableIdentity("  MARÍA  López ")).toBe("maria lopez");
  });
});
