import { renderHook } from "@testing-library/react-native";

import { haptic } from "./haptics";
import {
  queueBatchIntent,
  queueTransitionIntent,
  type ScanOutcome,
  scanOutcomeHaptic,
  scanOutcomeIntent,
} from "./scan-haptics";
import { useQueueTransitionHaptics } from "./use-queue-haptics";

jest.mock("./haptics", () => ({ haptic: jest.fn(() => Promise.resolve()) }));

const scan = (id: string, status: "pending" | "acknowledged" | "failed") =>
  ({ id, status }) as Parameters<typeof useQueueTransitionHaptics>[0][number];

describe("scanner outcome haptics (#1170)", () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ["accepted", "success"],
    ["queued", "light"],
    ["duplicate", "warning"],
    ["rejected", "error"],
    ["unknown", "error"],
  ] as const satisfies ReadonlyArray<
    readonly [ScanOutcome, string]
  >)("maps %s to the %s haptic", async (outcome, intent) => {
    expect(scanOutcomeIntent(outcome)).toBe(intent);
    await scanOutcomeHaptic(outcome);
    expect(haptic).toHaveBeenCalledWith(intent);
  });
});

describe("queue transition haptics (#1170)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("maps confirmation to success and rejection to error", () => {
    expect(queueTransitionIntent("pending", "acknowledged")).toBe("success");
    expect(queueTransitionIntent("pending", "failed")).toBe("error");
  });

  it("stays silent for new, unchanged and retried entries", () => {
    expect(queueTransitionIntent(undefined, "pending")).toBeNull();
    expect(queueTransitionIntent(undefined, "failed")).toBeNull();
    expect(queueTransitionIntent("failed", "failed")).toBeNull();
    expect(queueTransitionIntent("failed", "pending")).toBeNull();
  });

  it("collapses a batch into one haptic, errors winning over successes", () => {
    const before = [scan("a", "pending"), scan("b", "pending"), scan("c", "pending")];
    expect(
      queueBatchIntent(before, [
        scan("a", "acknowledged"),
        scan("b", "acknowledged"),
        scan("c", "pending"),
      ]),
    ).toBe("success");
    expect(
      queueBatchIntent(before, [
        scan("a", "acknowledged"),
        scan("b", "failed"),
        scan("c", "pending"),
      ]),
    ).toBe("error");
    expect(queueBatchIntent(before, before)).toBeNull();
  });

  it("fires once per queue change and not for the initial snapshot", async () => {
    const { rerender } = await renderHook(
      ({ queue }: { queue: ReturnType<typeof scan>[] }) => useQueueTransitionHaptics(queue),
      { initialProps: { queue: [scan("a", "failed")] } },
    );
    expect(haptic).not.toHaveBeenCalled();

    await rerender({ queue: [scan("a", "failed"), scan("b", "pending")] });
    expect(haptic).not.toHaveBeenCalled();

    await rerender({ queue: [scan("a", "failed"), scan("b", "acknowledged")] });
    expect(haptic).toHaveBeenCalledTimes(1);
    expect(haptic).toHaveBeenCalledWith("success");

    await rerender({ queue: [scan("a", "failed"), scan("b", "acknowledged")] });
    expect(haptic).toHaveBeenCalledTimes(1);
  });
});
