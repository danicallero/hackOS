import { errorReasonCopyKey } from "@hackos/shared/error-reasons";
import commonEn from "@hackos/shared/locales/en/common.json";
import type { MessageKey, Translate } from "@/lib/i18n";

/** Mirrors `batchIdsSchema`'s `.max(100)` in the API. */
export const BATCH_MAX = 100;

export interface BatchSkip {
  id: number;
  /** Stable reason; rendered as `apiError_<code>`. */
  code?: string;
  reason: string;
}

export interface BatchResponse {
  processed?: number;
  sent?: number;
  skipped?: BatchSkip[];
}

export interface ChunkedBatchResult {
  processed: number | undefined;
  skipped: BatchSkip[];
  /** Ids no request reached because an earlier chunk failed. */
  unsent: number[];
  /** The failure that stopped the run; earlier chunks are already applied. */
  error: unknown;
}

/**
 * The response batch routes accept at most BATCH_MAX ids per request (H14),
 * while "select all" can pick every response. Send sequential chunks and merge
 * their results. A failing chunk stops the run but never discards what the
 * earlier, already-committed chunks did.
 */
export async function runChunkedBatch(
  ids: number[],
  send: (chunk: number[]) => Promise<BatchResponse | undefined>,
): Promise<ChunkedBatchResult> {
  let processed: number | undefined;
  const skipped: BatchSkip[] = [];
  for (let i = 0; i < ids.length; i += BATCH_MAX) {
    try {
      const result = await send(ids.slice(i, i + BATCH_MAX));
      const count = result?.processed ?? result?.sent;
      if (count !== undefined) processed = (processed ?? 0) + count;
      skipped.push(...(result?.skipped ?? []));
    } catch (error) {
      return { processed: processed ?? 0, skipped, unsent: ids.slice(i), error };
    }
  }
  return { processed, skipped, unsent: [], error: null };
}

/** Localized reason for a skipped row; never the English server message. */
export function skipReasonText(code: string | undefined, t: Translate): string {
  if (code) {
    const key = errorReasonCopyKey(code);
    if (key in commonEn) return t(key as MessageKey);
  }
  return t("batchSkipFailed");
}

/** Group skipped rows by reason, so 150 "form is full" rows read as one line. */
export function groupSkips(
  skipped: Array<{ reason: string; applicant: string }>,
): Array<{ reason: string; applicants: string[] }> {
  const groups = new Map<string, string[]>();
  for (const item of skipped) {
    const applicants = groups.get(item.reason) ?? [];
    applicants.push(item.applicant);
    groups.set(item.reason, applicants);
  }
  return [...groups].map(([reason, applicants]) => ({ reason, applicants }));
}
