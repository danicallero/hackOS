import { isBarcodeInsideFrame } from "./qr-frame";

const viewport = { height: 800, width: 400 };

describe("QR scanner frame", () => {
  it("accepts a QR fully contained by the cutout", () => {
    expect(
      isBarcodeInsideFrame(
        {
          cornerPoints: [
            { x: 120, y: 300 },
            { x: 280, y: 300 },
            { x: 280, y: 500 },
            { x: 120, y: 500 },
          ],
          bounds: { origin: { x: 0, y: 0 }, size: { height: 0, width: 0 } },
        },
        viewport,
        264,
      ),
    ).toBe(true);
  });

  it("rejects a QR when any corner is outside the cutout", () => {
    expect(
      isBarcodeInsideFrame(
        {
          cornerPoints: [
            { x: 20, y: 300 },
            { x: 150, y: 300 },
            { x: 150, y: 430 },
            { x: 20, y: 430 },
          ],
          bounds: { origin: { x: 0, y: 0 }, size: { height: 0, width: 0 } },
        },
        viewport,
        264,
      ),
    ).toBe(false);
  });

  it("falls back to non-empty bounds when corner points are unavailable", () => {
    expect(
      isBarcodeInsideFrame(
        {
          cornerPoints: [],
          bounds: { origin: { x: 100, y: 300 }, size: { height: 200, width: 200 } },
        },
        viewport,
        264,
      ),
    ).toBe(true);
  });
});
