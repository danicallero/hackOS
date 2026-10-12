import { describe, expect, it } from "vitest";
import { initials } from "./initials";

describe("initials", () => {
  it("uses the first and last word, or two letters of a single word", () => {
    expect(initials("María José F.")).toBe("MF");
    expect(initials("  acme ")).toBe("AC");
  });

  it("falls back to ? and keeps astral characters whole", () => {
    expect(initials("   ")).toBe("?");
    expect(initials("𝒜da 𝒵oe")).toBe("𝒜𝒵");
  });
});
