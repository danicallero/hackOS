import { describe, expect, it } from "vitest";
import { initialView } from "./city-globe";

const place = (lat: number, lon: number, n = 1) => ({
  label: `${lat},${lon}`,
  n,
  lat,
  lon,
  approximate: false,
  region: `${lat},${lon}`,
});

describe("initialView (H27)", () => {
  it("zooms in on answers gathered in one region", () => {
    const view = initialView([
      place(43.37, -8.4, 30),
      place(42.24, -8.72, 10),
      place(40.42, -3.7, 5),
    ]);
    expect(view.zoom).toBeGreaterThan(4);
    expect(view.center[1]).toBeGreaterThan(40);
  });

  it("shows the whole globe instead of a disk that barely overflows the panel", () => {
    const view = initialView([
      place(43.37, -8.4, 3),
      place(40.71, -74.01, 2),
      place(-34.6, -58.38, 2),
      place(6.52, 3.38, 2),
      place(55.75, 37.62, 1),
    ]);
    expect(view.zoom).toBe(1);
  });
});
