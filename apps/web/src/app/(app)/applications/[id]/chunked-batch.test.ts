import { describe, expect, it, vi } from "vitest";
import { BATCH_MAX, groupSkips, runChunkedBatch, skipReasonText } from "./chunked-batch";

describe("runChunkedBatch (H14)", () => {
  it("splits more than BATCH_MAX ids into sequential requests and merges results", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => i + 1);
    const send = vi.fn(async (chunk: number[]) => ({
      processed: chunk.length - 1,
      skipped: [{ id: chunk[0] as number, reason: "invalid_transition" }],
    }));

    const result = await runChunkedBatch(ids, send);

    expect(send.mock.calls.map(([chunk]) => chunk.length)).toEqual([BATCH_MAX, BATCH_MAX, 50]);
    expect(send.mock.calls.flatMap(([chunk]) => chunk)).toEqual(ids);
    expect(result.processed).toBe(247);
    expect(result.skipped.map((s) => s.id)).toEqual([1, 101, 201]);
  });

  it("sends a single request within the limit and accepts `sent` counts", async () => {
    const send = vi.fn(async () => ({ sent: 3 }));
    const result = await runChunkedBatch([1, 2, 3], send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ processed: 3, skipped: [], unsent: [], error: null });
  });

  it("stops at a failing chunk and keeps the committed chunks' results", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => i + 1);
    const failure = new Error("boom");
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        processed: 99,
        skipped: [{ id: 7, code: "capacity_full", reason: "x" }],
      })
      .mockRejectedValueOnce(failure);
    const result = await runChunkedBatch(ids, send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(result.processed).toBe(99);
    expect(result.skipped).toEqual([{ id: 7, code: "capacity_full", reason: "x" }]);
    expect(result.unsent).toEqual(ids.slice(BATCH_MAX));
    expect(result.error).toBe(failure);
  });
});

describe("skip reasons (H14)", () => {
  const t = ((key: string) => `t:${key}`) as Parameters<typeof skipReasonText>[1];

  it("translates known codes and falls back for unknown or missing ones", () => {
    expect(skipReasonText("capacity_full", t)).toBe("t:apiError_capacity_full");
    expect(skipReasonText("deadlock_detected", t)).toBe("t:batchSkipFailed");
    expect(skipReasonText(undefined, t)).toBe("t:batchSkipFailed");
  });

  it("groups applicants by reason in first-seen order", () => {
    expect(
      groupSkips([
        { reason: "full", applicant: "Ana" },
        { reason: "sent", applicant: "Bo" },
        { reason: "full", applicant: "Cai" },
      ]),
    ).toEqual([
      { reason: "full", applicants: ["Ana", "Cai"] },
      { reason: "sent", applicants: ["Bo"] },
    ]);
  });
});
