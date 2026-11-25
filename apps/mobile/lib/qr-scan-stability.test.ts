import { advanceQrScanCandidate, type QrScanCandidate } from "./qr-scan-stability";

const centered = { areaRatio: 0.25, centerX: 0, centerY: 0 };

describe("QR scan stability", () => {
  it("accepts the same QR after two stable detections 65ms apart", () => {
    const result = advanceQrScanCandidate(null, "badge-1", centered, 1_000);
    expect(result.accepted).toBe(false);

    const tooSoon = advanceQrScanCandidate(result.candidate, "badge-1", centered, 1_050);
    expect(tooSoon.accepted).toBe(false);

    expect(advanceQrScanCandidate(result.candidate, "badge-1", centered, 1_065)).toEqual({
      accepted: true,
      candidate: null,
    });
  });

  it("accepts identical geometry after the native event throttle", () => {
    const first = advanceQrScanCandidate(null, "badge-1", centered, 1_000);
    expect(advanceQrScanCandidate(first.candidate, "badge-1", centered, 1_510).accepted).toBe(true);
  });

  it("does not accept duplicate callbacks from a single instant", () => {
    let candidate: QrScanCandidate | null = null;
    candidate = advanceQrScanCandidate(candidate, "badge-1", centered, 1_000).candidate;
    candidate = advanceQrScanCandidate(candidate, "badge-1", centered, 1_000).candidate;
    const result = advanceQrScanCandidate(candidate, "badge-1", centered, 1_000);

    expect(result.accepted).toBe(false);
  });

  it("restarts confirmation after the apparent size jumps during a lens switch", () => {
    let candidate = advanceQrScanCandidate(null, "badge-1", centered, 1_000).candidate;
    candidate = advanceQrScanCandidate(candidate, "badge-1", centered, 1_050).candidate;

    const switched = advanceQrScanCandidate(
      candidate,
      "badge-1",
      { areaRatio: 0.4, centerX: 0, centerY: 0 },
      1_100,
    );

    expect(switched.accepted).toBe(false);
    expect(switched.candidate?.detections).toBe(1);
    expect(switched.candidate?.firstSeenAt).toBe(1_100);
  });

  it("restarts confirmation when a lens transition shifts the QR", () => {
    const candidate = advanceQrScanCandidate(null, "badge-1", centered, 1_000).candidate;
    const shifted = advanceQrScanCandidate(
      candidate,
      "badge-1",
      { areaRatio: 0.25, centerX: 0.11, centerY: 0 },
      1_050,
    );

    expect(shifted.candidate?.detections).toBe(1);
  });

  it("restarts confirmation for a different QR or a long frame gap", () => {
    const candidate = advanceQrScanCandidate(null, "badge-1", centered, 1_000).candidate;
    const different = advanceQrScanCandidate(candidate, "badge-2", centered, 1_050);
    expect(different.candidate?.detections).toBe(1);

    const delayed = advanceQrScanCandidate(different.candidate, "badge-2", centered, 1_801);
    expect(delayed.candidate?.detections).toBe(1);
  });
});
