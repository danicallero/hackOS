import { describe, expect, it, vi } from "vitest";
import {
  matchingQueries,
  rankMatchingUsers,
  safeSuggestion,
  searchableIdentity,
  searchIdentityCandidates,
} from "./identity-matches";

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
  it("queries only the complete name and email handle, never lone name parts", () => {
    expect(matchingQueries(person)).toEqual(["María López", "maria"]);
    expect(matchingQueries({ name: "María", surname: null, email: person.email })).toEqual([
      "maria",
    ]);
  });
  it("preselects only a unique top-ranked candidate", () => {
    const ranked = rankMatchingUsers(person, [sameHandle, sameName], true);
    expect(safeSuggestion(person, ranked, true)).toEqual(sameName);
    const tie = { ...sameName, id: 4, email: "other@platform.test" };
    expect(
      safeSuggestion(person, rankMatchingUsers(person, [sameName, tie], true), true),
    ).toBeNull();
    // A full-name match plus an email handle outranks a plain full-name twin.
    const both = { ...sameName, id: 5, email: "maria@elsewhere.test" };
    expect(safeSuggestion(person, rankMatchingUsers(person, [sameName, both], true), true)).toEqual(
      both,
    );
  });
  it("does not preselect from a handle alone or a truncated candidate list", () => {
    expect(safeSuggestion(person, [sameHandle], true)).toBeNull();
    expect(safeSuggestion(person, [sameName], false)).toBeNull();
  });
  it("bounds suggestion and manual searches with separate limits", async () => {
    const fetchUsers = vi.fn().mockResolvedValue([sameName, unrelated]);
    expect(await searchIdentityCandidates(person, "", fetchUsers)).toEqual({
      users: [sameName],
      complete: true,
    });
    expect(fetchUsers.mock.calls).toEqual([
      ["María López", 50],
      ["maria", 50],
    ]);
    fetchUsers.mockClear();
    await searchIdentityCandidates(person, "Mar", fetchUsers);
    expect(fetchUsers.mock.calls).toEqual([["Mar", 20]]);
  });
});
