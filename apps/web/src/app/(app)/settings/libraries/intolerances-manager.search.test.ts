import { describe, expect, it } from "vitest";
import type { Intolerance } from "@/lib/types";
import { filterIntolerancesBySearch } from "./intolerances-manager";

const entries: Intolerance[] = [
  {
    id: 1,
    label: { es: "Núñez", en: "Nuts", gl: "Noces" },
    description: null,
  },
  {
    id: 2,
    label: { es: "Lácteos", en: "Dairy", gl: "Lácteos" },
    description: null,
  },
];

describe("intolerance dictionary search", () => {
  it("matches localized labels without case or accent sensitivity", () => {
    expect(filterIntolerancesBySearch(entries, "NUÑEZ").map((entry) => entry.id)).toEqual([1]);
  });
});
