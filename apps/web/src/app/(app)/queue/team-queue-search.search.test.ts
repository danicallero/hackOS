import { describe, expect, it } from "vitest";
import { filterTeamCandidates } from "./team-queue-search";

describe("team queue search", () => {
  it("matches team names without case or accent sensitivity", () => {
    const teams = [
      { repoId: 1, repoName: "José Núñez" },
      { repoId: 2, repoName: "A Coruña" },
    ];
    expect(filterTeamCandidates(teams, "JOSE nunez")).toEqual([teams[0]]);
    expect(filterTeamCandidates(teams, "coruna")).toEqual([teams[1]]);
  });
});
