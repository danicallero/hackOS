/**
 * Pure rules for the Scanner's two-pane layout (H22-H26, H55, H59): in a window wide enough for a
 * list beside a detail (`listDetailLayout().enabled`) the reader stays on the left and the scanned
 * person's profile opens on the right; narrower windows keep pushing the person route. Decisions
 * take measured values only, so a fold, a rotation or a resized window changes the branch without
 * remounting the reader.
 */

/** The person shown in the right pane, plus the optional deep-link focus on one history record. */
export interface ScanSelection {
  userId: number;
  focusLogId?: string;
  focusSource?: string;
}

type Param = string | string[] | undefined;

function first(value: Param): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** A person id from a route param: a positive integer, or null for anything else. */
export function parseScanUserId(raw: Param): number | null {
  const value = first(raw);
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** The selection a `personId` route param (and its optional focus params) asks for. */
export function selectionFromParams(params: {
  personId?: Param;
  focusLogId?: Param;
  focusSource?: Param;
}): ScanSelection | null {
  const userId = parseScanUserId(params.personId);
  if (userId === null) return null;
  const focusLogId = first(params.focusLogId);
  const focusSource = first(params.focusSource);
  return {
    userId,
    ...(focusLogId ? { focusLogId } : {}),
    ...(focusSource ? { focusSource } : {}),
  };
}

/** Where a successful scan goes: the right pane in two panes, the person route otherwise. */
export function scanDestination(twoPane: boolean): "pane" | "route" {
  return twoPane ? "pane" : "route";
}

/** Keeps the current object when the scan resolves to the person already shown. */
export function nextSelection(current: ScanSelection | null, next: ScanSelection): ScanSelection {
  return current &&
    current.userId === next.userId &&
    current.focusLogId === next.focusLogId &&
    current.focusSource === next.focusSource
    ? current
    : next;
}

/** "View people" opens over the reader in two panes and pushes the directory route otherwise. */
export function peopleDestination(twoPane: boolean): "overlay" | "route" {
  return twoPane ? "overlay" : "route";
}

/** What Android back does: close the people overlay first, then clear the pane, then leave. */
export function backAction(
  twoPane: boolean,
  peopleOpen: boolean,
  selection: ScanSelection | null,
): "close-people" | "clear-selection" | "system" {
  if (!twoPane) return "system";
  if (peopleOpen) return "close-people";
  return selection !== null ? "clear-selection" : "system";
}

/** Remount key of the embedded profile: a different person never inherits another's state. */
export function selectionKey(selection: ScanSelection): string {
  return `${selection.userId}:${selection.focusSource ?? ""}:${selection.focusLogId ?? ""}`;
}

/** Scroll distance over which the detail pane's top backing fades in. */
export const DETAIL_BAND_FADE_DISTANCE = 16;

/** Opacity of the detail pane's top backing for a scroll offset. */
export function detailBandOpacity(offset: number): number {
  return Math.min(1, Math.max(0, offset / DETAIL_BAND_FADE_DISTANCE));
}

/** Scroll offset at which the finder's large title starts handing over to the inline one. */
export const TITLE_COLLAPSE_START = 8;
/** Scroll distance over which the large title hands over to the inline title and hairline. */
export const TITLE_COLLAPSE_RANGE = 32;

/**
 * 0 at rest (large title shown), 1 once collapsed (inline title and hairline shown). A worklet, so
 * the finder's scroll drives its header on the UI thread without a React render.
 */
export function collapseProgress(offset: number): number {
  "worklet";
  return Math.min(1, Math.max(0, (offset - TITLE_COLLAPSE_START) / TITLE_COLLAPSE_RANGE));
}
