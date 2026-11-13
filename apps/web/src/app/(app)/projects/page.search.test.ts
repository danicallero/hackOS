import { describe, expect, it } from "vitest";
import { filterProjectsByName } from "./page";

describe("project name search", () => {
  it("matches without case or accent sensitivity", () => {
    const projects = [
      { id: 1, name: "José Núñez" },
      { id: 2, name: "A Coruña" },
    ];
    expect(filterProjectsByName(projects, "JOSE nunez")).toEqual([projects[0]]);
    expect(filterProjectsByName(projects, "coruna")).toEqual([projects[1]]);
  });
});
