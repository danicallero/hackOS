import { describe, expect, it } from "vitest";
import {
  canonicalCityAnswer,
  canonicalCountry,
  canonicalRegion,
  spanishCommunity,
  spanishProvinceCapital,
} from "./places.js";

describe("canonical city answers (H11, H27)", () => {
  it("names a country the same way whatever language it arrived in", () => {
    for (const name of ["Spain", "España", "espana", "Espanya", "Espagne", "Spanien"]) {
      expect(canonicalCountry(name)).toBe("España");
    }
    expect(canonicalCountry("Brazil")).toBe("Brasil");
    expect(canonicalCountry(" Atlantis ")).toBe("Atlantis");
  });

  it("names Spanish communities once and leaves other provinces alone", () => {
    expect(canonicalRegion("Catalonia", "Spain")).toBe("Cataluña");
    expect(canonicalRegion("Catalunya", "España")).toBe("Cataluña");
    expect(canonicalRegion("Aragon", "Spain")).toBe("Aragón");
    expect(canonicalRegion("Castille-La Mancha", "Spain")).toBe("Castilla-La Mancha");
    expect(canonicalRegion("Pontevedra", "Spain")).toBe("Pontevedra");
    expect(canonicalRegion("La Coruña", "Spain")).toBe("A Coruña");
    expect(canonicalRegion("Orense", "España")).toBe("Ourense");
    expect(canonicalRegion("Vizcaya", "España")).toBe("Bizkaia");
    expect(canonicalRegion("Catalonia", "Atlantis")).toBe("Catalonia");
  });

  it("canonicalizes a whole answer", () => {
    expect(
      canonicalCityAnswer({ city: " Zaragoza ", province: "Aragon", country: "Spain" }),
    ).toEqual({ city: "Zaragoza", province: "Aragón", country: "España" });
  });

  it("knows each Spanish province's community and capital", () => {
    expect(spanishCommunity("La Coruña", "España")).toBe("Galicia");
    expect(spanishCommunity("Catalunya", "Spain")).toBe("Cataluña");
    expect(spanishCommunity("Lisboa", "Portugal")).toBeNull();
    expect(spanishProvinceCapital("Lérida", "España")).toBe("Lleida");
    expect(spanishProvinceCapital("Galicia", "España")).toBeNull();
  });
});
