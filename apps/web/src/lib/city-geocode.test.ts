import { describe, expect, it } from "vitest";
import { loadCityIndex, parseCityLabel, placeCities } from "@/lib/city-geocode";

describe("city geocoding for the statistics globe (H27)", () => {
  it("splits a charted answer into its parts", () => {
    expect(parseCityLabel("Vigo, Galicia, España")).toEqual({
      city: "Vigo",
      province: "Galicia",
      country: "España",
    });
    expect(parseCityLabel("Vigo, España")).toEqual({
      city: "Vigo",
      province: "",
      country: "España",
    });
    expect(parseCityLabel("Vigo, Galicia")).toEqual({
      city: "Vigo",
      province: "Galicia",
      country: "",
    });
  });

  it("places indexed cities, ignoring accents and the answer's language", async () => {
    const index = await loadCityIndex();
    const { places, unplaced } = placeCities(index, [
      { label: "A Coruña, Galicia, España", n: 5 },
      { label: "Malaga, Andalusia, Spain", n: 2 },
    ]);
    expect(unplaced).toBe(0);
    expect(places).toHaveLength(2);
    expect(places[0]).toMatchObject({ n: 5, approximate: false });
    expect(places[0]?.lat).toBeCloseTo(43.37, 1);
    expect(places[0]?.lon).toBeCloseTo(-8.4, 1);
    expect(places[1]?.lat).toBeCloseTo(36.72, 1);
  });

  it("falls back to the country's capital and counts the unrecognisable", async () => {
    const index = await loadCityIndex();
    const { places, unplaced } = placeCities(index, [
      { label: "Braga, Braga, Portugal", n: 3 },
      { label: "Atlantis, Nowhere, Neverland", n: 4 },
      { label: "Empty, Nowhere, España", n: 0 },
    ]);
    expect(places).toEqual([
      expect.objectContaining({ label: "Braga, Braga, Portugal", n: 3, approximate: true }),
    ]);
    expect(places[0]?.lat).toBeCloseTo(38.73, 1);
    expect(unplaced).toBe(4);
  });

  it("prefers the answer's region, across languages, then a town over a district", async () => {
    const index = await loadCityIndex();
    const { places } = placeCities(index, [
      { label: "Salamanca, Castilla y León, España", n: 1 },
      { label: "Salamanca, Salamanca, España", n: 1 },
      { label: "Salamanca, Madrid, España", n: 1 },
    ]);
    expect(places.map((place) => Math.round(place.lat))).toEqual([41, 41, 40]);
  });

  it("ignores a leading article the index spells differently", async () => {
    const index = await loadCityIndex();
    const { places } = placeCities(index, [
      { label: "O Porriño, Galicia, España", n: 2 },
      { label: "La Coruña, Galicia, España", n: 1 },
    ]);
    expect(places).toEqual([
      expect.objectContaining({ approximate: false }),
      expect.objectContaining({ approximate: false }),
    ]);
    expect(places[0]?.lat).toBeCloseTo(42.16, 1);
    expect(places[0]?.lon).toBeCloseTo(-8.62, 1);
    expect(places[1]?.lat).toBeCloseTo(43.37, 1);
  });

  it("places municipalities whose seat GeoNames lists without population", async () => {
    const index = await loadCityIndex();
    const { places } = placeCities(index, [{ label: "Xove, Galicia, España", n: 1 }]);
    expect(places[0]).toMatchObject({ approximate: false });
    expect(places[0]?.lat).toBeCloseTo(43.69, 1);
    expect(places[0]?.lon).toBeCloseTo(-7.51, 1);
  });

  it("falls back to the answer's region before the country's capital", async () => {
    const index = await loadCityIndex();
    const { places } = placeCities(index, [{ label: "Aldea Perdida, Galicia, España", n: 1 }]);
    expect(places[0]).toMatchObject({ approximate: true });
    // Galicia's largest indexed place (Vigo), not Madrid.
    expect(places[0]?.lon).toBeLessThan(-7);
  });

  it("groups answers by canonical region whatever language they were written in", async () => {
    const index = await loadCityIndex();
    const { places } = placeCities(index, [
      { label: "Girona, Catalonia, Spain", n: 1 },
      { label: "Barcelona, Cataluña, España", n: 1 },
      { label: "Zaragoza, Aragon, España", n: 1 },
    ]);
    expect(places[0]?.region).toBe(places[1]?.region);
    expect(places[2]?.region).not.toBe(places[0]?.region);
  });
});
