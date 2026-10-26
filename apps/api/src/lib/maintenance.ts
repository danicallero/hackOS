import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";

/**
 * Host-owned maintenance lock (#539). `deploy/scripts/restore.sh` writes
 * `state.json` into `MAINTENANCE_DIR` before it swaps the database, so the
 * lock cannot live in the database being replaced. Every API replica reads
 * the same file; a read is cached for a second so the gate costs one
 * `readFile` per second, not per request.
 */
export const MAINTENANCE_PHASES = ["draining", "restoring", "verifying", "failed"] as const;
export type MaintenancePhase = (typeof MAINTENANCE_PHASES)[number];

export interface MaintenanceState {
  active: true;
  phase: MaintenancePhase;
  restoreId: string | null;
  startedAt: string | null;
  /** Operator estimate; clients show it as a hint only. */
  etaAt: string | null;
}

export type MaintenanceStatus = MaintenanceState | { active: false };

const CACHE_MS = 1000;
let cached: { at: number; status: MaintenanceStatus } | null = null;

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Fail closed: a present but unreadable file still blocks traffic. */
export function parseMaintenanceState(raw: string): MaintenanceState {
  let doc: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") doc = parsed as Record<string, unknown>;
  } catch {
    // keep the defaults below
  }
  const phase = MAINTENANCE_PHASES.find((candidate) => candidate === doc.phase) ?? "restoring";
  return {
    active: true,
    phase,
    restoreId: str(doc.restoreId),
    startedAt: str(doc.startedAt),
    etaAt: str(doc.etaAt),
  };
}

export async function getMaintenanceStatus(now = Date.now()): Promise<MaintenanceStatus> {
  const dir = config.MAINTENANCE_DIR;
  if (!dir) return { active: false };
  if (cached && now - cached.at < CACHE_MS) return cached.status;
  let status: MaintenanceStatus;
  try {
    status = parseMaintenanceState(await readFile(join(dir, "state.json"), "utf8"));
  } catch (err) {
    // Only a missing file means "no maintenance"; any other read error blocks.
    status =
      (err as NodeJS.ErrnoException).code === "ENOENT"
        ? { active: false }
        : parseMaintenanceState("");
  }
  cached = { at: now, status };
  return status;
}

/** Test seam: drops the one-second cache. */
export function resetMaintenanceCache(): void {
  cached = null;
}
