import { isBarcodeScannableInFrame } from "./qr-frame";

const viewport = { height: 800, width: 400 };

describe("QR scanner frame", () => {
  it("accepts a QR fully contained by the cutout", () => {
    expect(
      isBarcodeScannableInFrame(
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
      isBarcodeScannableInFrame(
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
      isBarcodeScannableInFrame(
        {
          cornerPoints: [],
          bounds: { origin: { x: 100, y: 300 }, size: { height: 200, width: 200 } },
        },
        viewport,
        264,
      ),
    ).toBe(true);
  });

  it("rejects a tiny QR even when it is centered in the cutout", () => {
    expect(
      isBarcodeScannableInFrame(
        {
          cornerPoints: [
            { x: 165, y: 365 },
            { x: 235, y: 365 },
            { x: 235, y: 435 },
            { x: 165, y: 435 },
          ],
          bounds: { origin: { x: 165, y: 365 }, size: { height: 70, width: 70 } },
        },
        viewport,
        264,
      ),
    ).toBe(false);
  });

  it("rejects a large QR that is inside the cutout but not deliberately centered", () => {
    expect(
      isBarcodeScannableInFrame(
        {
          cornerPoints: [
            { x: 70, y: 340 },
            { x: 190, y: 340 },
            { x: 190, y: 460 },
            { x: 70, y: 460 },
          ],
          bounds: { origin: { x: 70, y: 340 }, size: { height: 120, width: 120 } },
        },
        viewport,
        264,
      ),
    ).toBe(false);
  });

  it("measures iOS corner ordering correctly when enforcing minimum size", () => {
    expect(
      isBarcodeScannableInFrame(
        {
          cornerPoints: [
            { x: 140, y: 460 },
            { x: 260, y: 460 },
            { x: 140, y: 340 },
            { x: 260, y: 340 },
          ],
          bounds: { origin: { x: 140, y: 340 }, size: { height: 120, width: 120 } },
        },
        viewport,
        264,
      ),
    ).toBe(true);
  });

  it("rejects tiny bounds when corner points are unavailable", () => {
    expect(
      isBarcodeScannableInFrame(
        {
          cornerPoints: [],
          bounds: { origin: { x: 175, y: 375 }, size: { height: 50, width: 50 } },
        },
        viewport,
        264,
      ),
    ).toBe(false);
  });

  it("accepts a centered QR when Android reports horizontally mirrored points", () => {
    expect(
      isBarcodeScannableInFrame(
        {
          cornerPoints: [
            { x: 280, y: 300 },
            { x: 120, y: 300 },
            { x: 120, y: 500 },
            { x: 280, y: 500 },
          ],
          bounds: { origin: { x: 120, y: 300 }, size: { height: 200, width: 160 } },
        },
        viewport,
        264,
      ),
    ).toBe(true);
  });

  it("still rejects an outside QR when Android reports both axes flipped", () => {
    expect(
      isBarcodeScannableInFrame(
        {
          cornerPoints: [
            { x: 380, y: 500 },
            { x: 250, y: 500 },
            { x: 250, y: 370 },
            { x: 380, y: 370 },
          ],
          bounds: { origin: { x: 250, y: 370 }, size: { height: 130, width: 130 } },
        },
        viewport,
        264,
      ),
    ).toBe(false);
  });

  it("accepts the same centered QR after a quarter-turn orientation change", () => {
    expect(
      isBarcodeScannableInFrame(
        {
          cornerPoints: [
            { x: 500, y: 120 },
            { x: 500, y: 280 },
            { x: 300, y: 280 },
            { x: 300, y: 120 },
          ],
          bounds: { origin: { x: 300, y: 120 }, size: { height: 160, width: 200 } },
        },
        { height: 400, width: 800 },
        264,
      ),
    ).toBe(true);
  });

  it("does not scan before the measured camera viewport is available", () => {
    expect(
      isBarcodeScannableInFrame(
        {
          cornerPoints: [
            { x: 120, y: 300 },
            { x: 280, y: 300 },
            { x: 280, y: 500 },
            { x: 120, y: 500 },
          ],
          bounds: { origin: { x: 120, y: 300 }, size: { height: 200, width: 160 } },
        },
        { height: 0, width: 0 },
        264,
      ),
    ).toBe(false);
  });
});
