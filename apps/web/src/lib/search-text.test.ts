import { describe, expect, it } from "vitest";
import { normalizeSearchText } from "./search-text";

describe("normalizeSearchText", () => {
  it("ignores case and Spanish and Galician accents", () => {
    expect(normalizeSearchText("JOSÉ")).toBe("jose");
    expect(normalizeSearchText("A Coruña")).toBe("a coruna");
    expect(normalizeSearchText("Enxeñaría Informática")).toBe("enxenaria informatica");
  });

  it("folds ñ, ü and combining marks", () => {
    expect(normalizeSearchText("Núñez lingüística")).toBe("nunez linguistica");
    expect(normalizeSearchText("Jo\u0301se")).toBe("jose");
  });

  it("trims leading and trailing whitespace and collapses repeated spaces", () => {
    expect(normalizeSearchText("  JOSE   Núñez\t\n")).toBe("jose nunez");
  });
});
