import { describe, expect, it } from "vitest";

// Compose supplies an empty value when the optional fixture secret is unset.
// Import config only after setting that value so this exercises boot parsing.
process.env.REVIEW_FIXTURE_PASSWORD = "";
const { config } = await import("../src/config.js");

describe("environment config", () => {
  it("treats an empty optional reviewer fixture password as unset (H54)", () => {
    expect(config.REVIEW_FIXTURE_PASSWORD).toBeUndefined();
  });
});
