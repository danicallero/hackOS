import { describe, expect, it } from "vitest";
import { filterFieldGroupsBySearch } from "./application-export-panel";

describe("application export field search", () => {
  it("matches group and field text without case or accent sensitivity", () => {
    const groups = [
      {
        key: "application-1",
        label: "A Coruña",
        options: [
          {
            id: "answer:name",
            label: "José Núñez",
            description: "participant_name",
            group: "answer" as const,
            selection: { source: "answer" as const, key: "participant_name", application_id: 1 },
          },
          {
            id: "answer:other",
            label: "Other",
            description: "other",
            group: "answer" as const,
            selection: { source: "answer" as const, key: "other", application_id: 1 },
          },
        ],
      },
    ];
    expect(filterFieldGroupsBySearch(groups, "JOSE NUNEZ")[0].options.map((o) => o.id)).toEqual([
      "answer:name",
    ]);
    expect(filterFieldGroupsBySearch(groups, "coruna")[0].options.map((o) => o.id)).toEqual([
      "answer:name",
      "answer:other",
    ]);
  });
});
