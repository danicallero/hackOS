import { describe, expect, it } from "vitest";
import type { ProjectSubmission } from "@/lib/projects";
import { filterSubmissions, submissionIssues } from "./submissions-list";

function project(overrides: Partial<ProjectSubmission> = {}): ProjectSubmission {
  return {
    id: 1,
    name: "Water AI",
    status: "submitted",
    submittedVia: "participant",
    submittedAt: "2026-10-08T12:00:00Z",
    changedSinceSubmit: false,
    lockedAt: null,
    lockReason: null,
    eligible: true,
    participantCount: 2,
    maxTeamSize: 4,
    teamSizeViolation: false,
    teamSizeException: false,
    eligibilityOverride: null,
    requests: [],
    canSubmit: true,
    ...overrides,
  };
}

const pendingRequest = {
  id: 5,
  reason: "Fix demo",
  status: "pending" as const,
  created_at: "2026-10-08T12:00:00Z",
  decision_reason: null,
};

describe("submissions list (H21, #1006)", () => {
  it("lists the decisions each project needs", () => {
    expect(submissionIssues(project())).toEqual([]);
    expect(
      submissionIssues(project({ requests: [pendingRequest], teamSizeViolation: true })),
    ).toEqual(["projectEditsRequested", "projectTeamSizeViolation"]);
    expect(submissionIssues(project({ status: "draft", submittedAt: null }))).toEqual([
      "projectDraft",
    ]);
    expect(submissionIssues(project({ status: "draft" }))).toEqual(["projectReopened"]);
  });

  it("filters by review scope, issue and name", () => {
    const projects = [
      project(),
      project({ id: 2, name: "Edit me", requests: [pendingRequest] }),
      project({ id: 3, name: "Draft", status: "draft", submittedAt: null }),
    ];
    expect(filterSubmissions(projects, "", "issues", []).map((p) => p.id)).toEqual([2, 3]);
    expect(filterSubmissions(projects, "", "all", ["projectDraft"]).map((p) => p.id)).toEqual([3]);
    expect(filterSubmissions(projects, "  water ", "all", []).map((p) => p.id)).toEqual([1]);
  });
});
