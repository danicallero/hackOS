import { describe, expect, it } from "vitest";
import {
  type Challenge,
  canAccessSponsorWorkspace,
  challengeNextAction,
  challengeState,
  filterChallengesForEnterprise,
} from "./shared";

function baseChallenge(overrides: Partial<Challenge> = {}): Challenge {
  return {
    id: 1,
    title: "Challenge",
    title_i18n: null,
    description: "A full description",
    description_i18n: null,
    criteria: "Judged on impact",
    criteria_i18n: null,
    prizes: [{ name: "Best overall" }],
    devpost_tags: [],
    judging_panel_criteria: [
      { key: "impact", label: "Impact", kind: "scale", min: 1, max: 5 },
    ] as never,
    max_presentation_seconds: null,
    max_in_waiting_area: null,
    visibility: "hidden",
    available_from: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("challengeState", () => {
  it("is draft when hidden with no scheduled reveal", () => {
    expect(challengeState({ visibility: "hidden", available_from: null })).toBe("draft");
  });

  it("is scheduled when hidden with a future reveal", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(challengeState({ visibility: "hidden", available_from: future })).toBe("scheduled");
  });

  it("is public once visible, regardless of available_from", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(challengeState({ visibility: "visible", available_from: past })).toBe("public");
    expect(challengeState({ visibility: "visible", available_from: null })).toBe("public");
  });
});

describe("challengeNextAction", () => {
  it("asks for a description first", () => {
    const challenge = baseChallenge({ description: "" });
    expect(challengeNextAction(challenge)).toBe("addDescription");
  });

  it("asks for public criteria next", () => {
    const challenge = baseChallenge({ criteria: "" });
    expect(challengeNextAction(challenge)).toBe("addCriteria");
  });

  it("asks for a prize next", () => {
    const challenge = baseChallenge({ prizes: [] });
    expect(challengeNextAction(challenge)).toBe("addPrize");
  });

  it("asks for a judging criterion next", () => {
    const challenge = baseChallenge({ judging_panel_criteria: [] });
    expect(challengeNextAction(challenge)).toBe("addJudgingCriterion");
  });

  it("asks to publish once content is complete but still a draft", () => {
    const challenge = baseChallenge();
    expect(challengeNextAction(challenge)).toBe("schedulePublish");
  });

  it("is null once complete and public", () => {
    const challenge = baseChallenge({ visibility: "visible" });
    expect(challengeNextAction(challenge)).toBeNull();
  });

  it("is null once complete and scheduled", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const challenge = baseChallenge({ available_from: future });
    expect(challengeNextAction(challenge)).toBeNull();
  });
});

describe("canAccessSponsorWorkspace", () => {
  it("admits org-wide admins regardless of sponsor association", () => {
    expect(canAccessSponsorWorkspace(true, false)).toBe(true);
  });

  it("admits a linked sponsor representative without admin capabilities (participant+sponsor)", () => {
    expect(canAccessSponsorWorkspace(false, true)).toBe(true);
  });

  it("admits a sponsor representative who also judges (sponsor+judge, H55 additive access)", () => {
    // isEnterpriseJudge doesn't change this check — the sponsor workspace is
    // reachable purely from the sponsor association, same as any other
    // capability combination the account happens to hold.
    expect(canAccessSponsorWorkspace(false, true)).toBe(true);
  });

  it("denies a plain judge with no sponsor association and no admin capability", () => {
    expect(canAccessSponsorWorkspace(false, false)).toBe(false);
  });
});

describe("filterChallengesForEnterprise", () => {
  const challenges: Challenge[] = [
    baseChallenge({ id: 1, enterprise_name: "Acme" }),
    baseChallenge({ id: 2, enterprise_name: "Globex" }),
    baseChallenge({ id: 3, enterprise_name: "Acme" }),
  ];

  it("scopes a cross-enterprise admin list down to one enterprise's challenges", () => {
    const scoped = filterChallengesForEnterprise(challenges, "Acme");
    expect(scoped.map((c) => c.id)).toEqual([1, 3]);
  });

  it("returns nothing for an enterprise with no challenges", () => {
    expect(filterChallengesForEnterprise(challenges, "Initech")).toEqual([]);
  });
});
