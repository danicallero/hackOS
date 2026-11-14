import { describe, expect, it, vi } from "vitest";
import { BATCH_MAX, runChunkedBatch } from "./chunked-batch";

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
    expect(result).toEqual({ processed: 3, skipped: [] });
  });

  it("stops at the first failing chunk", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => i + 1);
    const send = vi
      .fn()
      .mockResolvedValueOnce({ processed: BATCH_MAX })
      .mockRejectedValueOnce(new Error("boom"));
    await expect(runChunkedBatch(ids, send)).rejects.toThrow("boom");
    expect(send).toHaveBeenCalledTimes(2);
  });
});
