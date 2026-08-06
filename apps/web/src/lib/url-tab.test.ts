import { describe, expect, it } from "vitest";
import { resolveUrlTab } from "./url-tab";

const values = ["overview", "activity"] as const;

describe("resolveUrlTab (UX-03)", () => {
  it("keeps a valid deep-linked tab", () => {
    expect(resolveUrlTab("activity", { values, defaultValue: "overview" })).toBe("activity");
  });

  it("falls back safely for an unknown value", () => {
    expect(resolveUrlTab("broken", { values, defaultValue: "overview" })).toBe("overview");
  });

  it("maps legacy deep links to the grouped view", () => {
    expect(
      resolveUrlTab("presence", {
        values,
        defaultValue: "overview",
        aliases: { presence: "activity" },
      }),
    ).toBe("activity");
  });
});
