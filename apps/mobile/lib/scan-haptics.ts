import { type HapticIntent, haptic } from "./haptics";

/**
 * What a scan did, as the operator should feel it while looking at the camera
 * (#1170). Success, warning and error map onto the three notification haptics:
 * - `accepted`: the server (or local roster) confirmed the scan.
 * - `queued`: stored offline, not yet confirmed — a light tap, no verdict.
 * - `duplicate`: already registered, needs a decision — warning.
 * - `rejected`: the server refused the scan (business error) — error.
 * - `unknown`: unrecognised or revoked code — error.
 */
export type ScanOutcome = "accepted" | "queued" | "duplicate" | "rejected" | "unknown";

const SCAN_OUTCOME_INTENT: Record<ScanOutcome, HapticIntent> = {
  accepted: "success",
  queued: "light",
  duplicate: "warning",
  rejected: "error",
  unknown: "error",
};

export function scanOutcomeIntent(outcome: ScanOutcome): HapticIntent {
  return SCAN_OUTCOME_INTENT[outcome];
}

export function scanOutcomeHaptic(outcome: ScanOutcome): Promise<void> {
  return haptic(scanOutcomeIntent(outcome));
}

type QueueScanStatus = "pending" | "acknowledged" | "failed";
interface QueueEntry {
  id: string;
  status: QueueScanStatus;
}

/**
 * The haptic for one offline-queue entry changing state: confirmed by the
 * server is a success and rejected is an error. A retry is silent here: the
 * button that requested it already gave its own tap.
 */
export function queueTransitionIntent(
  previous: QueueScanStatus | undefined,
  next: QueueScanStatus,
): HapticIntent | null {
  if (previous === undefined || previous === next) return null;
  if (next === "acknowledged") return "success";
  if (next === "failed") return "error";
  return null;
}

/**
 * One haptic for a whole queue refresh. A replay can settle dozens of scans at
 * once, so an error beats a success instead of buzzing per entry. Entries
 * absent from `previous` (newly queued) are silent.
 */
export function queueBatchIntent(
  previous: ReadonlyArray<QueueEntry>,
  next: ReadonlyArray<QueueEntry>,
): HapticIntent | null {
  const before = new Map(previous.map((scan) => [scan.id, scan.status]));
  let winner: HapticIntent | null = null;
  for (const scan of next) {
    const intent = queueTransitionIntent(before.get(scan.id), scan.status);
    if (intent === "error" || (intent && !winner)) winner = intent;
  }
  return winner;
}
