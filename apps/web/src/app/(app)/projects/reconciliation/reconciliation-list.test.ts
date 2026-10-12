import { describe, expect, it } from "vitest";
import type { ProjectSubmission } from "@/lib/projects";
import { filterReconciliationRows, reconciliationRows } from "./reconciliation-list";

function project(overrides: Partial<ProjectSubmission> = {}): ProjectSubmission {
  return {
    id: 1,
    name: "Water AI",
    code: "K7M4Q",
    status: "submitted",
    submittedVia: "native",
    submittedAt: "2026-10-08T12:00:00Z",
    lockedAt: "2026-10-08T12:00:00Z",
    lockReason: "native_submission",
    devpostUrl: null,
    eligible: true,
    membershipDiffers: false,
    membershipResolution: null,
    unresolvedCount: 0,
    participantCount: 2,
    maxTeamSize: 4,
    teamSizeViolation: false,
    teamSizeException: false,
    eligibilityOverride: null,
    internal: [{ userId: 12, name: "Alice", surname: "Review", email: null }],
    external: [],
    requests: [],
    canSubmit: false,
    ...overrides,
  };
}

describe("reconciliation list (H16–H21)", () => {
  it("keeps planning and operational projects with the same ID independent", () => {
    const rows = reconciliationRows({
      projects: [project()],
      planned: [{ id: 1, name: "Planning", code: "ABC123", status: "draft" }],
    });
    expect(rows.map((row) => row.key)).toEqual(["repo:1", "group:1"]);
  });
  it("prioritizes pending decisions and surfaces unsubmitted records after deadline", () => {
    const rows = reconciliationRows({
      projects: [
        project(),
        project({
          id: 2,
          membershipDiffers: true,
          eligible: false,
          requests: [
            {
              id: 5,
              reason: "Fix demo",
              status: "pending",
              created_at: "2026-10-08T12:00:00Z",
              decision_reason: null,
            },
          ],
        }),
      ],
      planned: [{ id: 3, name: "Unsubmitted", code: "ABC123", status: "not_submitted" }],
    });
    expect(filterReconciliationRows(rows, "", "issues", [], []).map((row) => row.id)).toEqual([
      2, 3,
    ]);
    expect(rows[1]?.issues[0]).toBe("projectEditsRequested");
  });
  it("searches codes and people while combining source and issue filters", () => {
    const rows = reconciliationRows({
      projects: [
        project({ devpostUrl: "https://devpost.com/software/water", unresolvedCount: 1 }),
        project({ id: 2, name: "Native demo", teamSizeViolation: true }),
      ],
      planned: [],
    });
    expect(
      filterReconciliationRows(
        rows,
        "alice   review",
        "all",
        ["hybrid"],
        ["projectUnknownIdentity"],
      ),
    ).toHaveLength(1);
    expect(
      filterReconciliationRows(rows, "k7m4q", "issues", ["native"], ["projectTeamSizeViolation"])[0]
        ?.id,
    ).toBe(2);
    expect(filterReconciliationRows(rows, "", "all", [], [])).toHaveLength(2);
  });
  it("keeps resolved membership differences out of the issue list without hiding reopened submissions", () => {
    const rows = reconciliationRows({
      projects: [
        project({ membershipDiffers: true, membershipResolution: "internal" }),
        project({ id: 2, status: "draft", lockedAt: null }),
      ],
      planned: [],
    });
    expect(filterReconciliationRows(rows, "", "issues", [], []).map((row) => row.id)).toEqual([2]);
  });
});
