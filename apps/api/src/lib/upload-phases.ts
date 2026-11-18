import type pg from "pg";
import { withTransaction } from "../db/pool.js";
import { observeUploadPhase, type UploadOperation, type UploadPhase } from "./metrics.js";

/**
 * Timers for the file-upload routes (#934, H12, H54) feeding
 * `hackos_upload_phase_duration_seconds`; lib/metrics.ts owns the histogram and
 * its closed operation/phase/outcome labels. Instrumentation only observes:
 * the original result or error always propagates unchanged.
 */
function observe(
  operation: UploadOperation,
  phase: UploadPhase,
  startedAt: number,
  outcome: "ok" | "error",
): void {
  observeUploadPhase(operation, phase, (performance.now() - startedAt) / 1000, outcome);
}

export type PhaseTimer = <R>(phase: UploadPhase, run: () => R | Promise<R>) => Promise<R>;

export function uploadPhaseTimer(operation: UploadOperation): PhaseTimer {
  return async (phase, run) => {
    const startedAt = performance.now();
    try {
      const result = await run();
      observe(operation, phase, startedAt, "ok");
      return result;
    } catch (err) {
      observe(operation, phase, startedAt, "error");
      throw err;
    }
  };
}

/**
 * `withTransaction` that also times the connection/BEGIN and the COMMIT
 * (after the callback returned). A failed callback rolls back without a
 * commit observation; its own phase already recorded the error.
 */
export async function withUploadTransaction<T>(
  operation: UploadOperation,
  fn: (db: pg.PoolClient, phase: PhaseTimer) => Promise<T>,
): Promise<T> {
  const phase = uploadPhaseTimer(operation);
  const beganAt = performance.now();
  let callbackDoneAt: number | null = null;
  try {
    const result = await withTransaction(async (db) => {
      observe(operation, "tx_begin", beganAt, "ok");
      const result = await fn(db, phase);
      callbackDoneAt = performance.now();
      return result;
    });
    observe(operation, "commit", callbackDoneAt ?? beganAt, "ok");
    return result;
  } catch (err) {
    // The callback finished but COMMIT failed.
    if (callbackDoneAt !== null) observe(operation, "commit", callbackDoneAt, "error");
    throw err;
  }
}
