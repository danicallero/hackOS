/** Mirrors `batchIdsSchema`'s `.max(100)` in the API. */
export const BATCH_MAX = 100;

export interface BatchResponse {
  processed?: number;
  sent?: number;
  skipped?: { id: number; reason: string }[];
}

/**
 * The response batch routes accept at most BATCH_MAX ids per request (H14),
 * while "select all" can pick every response. Send sequential chunks and merge
 * their results; `processed` stays undefined when no chunk reported a count.
 */
export async function runChunkedBatch(
  ids: number[],
  send: (chunk: number[]) => Promise<BatchResponse | undefined>,
): Promise<{ processed: number | undefined; skipped: { id: number; reason: string }[] }> {
  let processed: number | undefined;
  const skipped: { id: number; reason: string }[] = [];
  for (let i = 0; i < ids.length; i += BATCH_MAX) {
    const result = await send(ids.slice(i, i + BATCH_MAX));
    const count = result?.processed ?? result?.sent;
    if (count !== undefined) processed = (processed ?? 0) + count;
    skipped.push(...(result?.skipped ?? []));
  }
  return { processed, skipped };
}
