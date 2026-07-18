import type { QrFrameObservation } from "./qr-frame";

const REQUIRED_DETECTIONS = 3;
const MIN_STABLE_DURATION_MS = 100;
const MAX_DETECTION_GAP_MS = 400;
const MAX_CENTER_SHIFT = 0.08;
const MAX_AREA_CHANGE_RATIO = 0.25;

export interface QrScanCandidate {
  data: string;
  detections: number;
  firstSeenAt: number;
  lastSeenAt: number;
  observation: QrFrameObservation;
}

export function advanceQrScanCandidate(
  previous: QrScanCandidate | null,
  data: string,
  observation: QrFrameObservation,
  seenAt: number,
): { accepted: boolean; candidate: QrScanCandidate | null } {
  const remainsStable =
    previous !== null &&
    previous.data === data &&
    seenAt >= previous.lastSeenAt &&
    seenAt - previous.lastSeenAt <= MAX_DETECTION_GAP_MS &&
    centerDistance(previous.observation, observation) <= MAX_CENTER_SHIFT &&
    areaChangeRatio(previous.observation, observation) <= MAX_AREA_CHANGE_RATIO;

  const candidate: QrScanCandidate = remainsStable
    ? {
        ...previous,
        detections: previous.detections + 1,
        lastSeenAt: seenAt,
        observation,
      }
    : {
        data,
        detections: 1,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
        observation,
      };

  const accepted =
    candidate.detections >= REQUIRED_DETECTIONS &&
    candidate.lastSeenAt - candidate.firstSeenAt >= MIN_STABLE_DURATION_MS;
  return { accepted, candidate: accepted ? null : candidate };
}

function centerDistance(a: QrFrameObservation, b: QrFrameObservation): number {
  return Math.hypot(a.centerX - b.centerX, a.centerY - b.centerY);
}

function areaChangeRatio(a: QrFrameObservation, b: QrFrameObservation): number {
  return Math.abs(a.areaRatio - b.areaRatio) / Math.max(a.areaRatio, Number.EPSILON);
}
