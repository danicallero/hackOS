// Spreadsheet-style keyboard navigation for the Manage Schedule grid (H59).
//
// This is the DOM half of the behaviour — it walks the rendered cells by their
// `data-schedule-*` attributes — while the pure "which way does this key move
// the focus" half lives in schedule-model.ts and is unit-tested there.

import {
  editingNavigationDirection,
  type ScheduleNavigationDirection,
  scheduleNavigationDirection,
} from "./schedule-model";

interface ScheduleCellAddress {
  row: string;
  column: string;
}

function scheduleCellAddress(element: HTMLElement): ScheduleCellAddress | null {
  const cell = element.closest<HTMLElement>('[data-schedule-cell="true"]');
  if (!cell?.dataset.scheduleRow || !cell.dataset.scheduleColumn) return null;
  return { row: cell.dataset.scheduleRow, column: cell.dataset.scheduleColumn };
}

function scheduleCellElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-schedule-cell="true"]')).filter(
    (cell) => {
      const target = cell.querySelector<HTMLElement>('[data-schedule-focusable="true"]');
      return target !== null && !target.hasAttribute("disabled");
    },
  );
}

function scheduleCellTarget(address: ScheduleCellAddress): HTMLElement | null {
  const cell = scheduleCellElements().find(
    (candidate) =>
      candidate.dataset.scheduleRow === address.row &&
      candidate.dataset.scheduleColumn === address.column,
  );
  return cell?.querySelector<HTMLElement>('[data-schedule-focusable="true"]') ?? null;
}

function scheduleNavigationTarget(
  element: HTMLElement,
  direction: ScheduleNavigationDirection,
): ScheduleCellAddress | null {
  const current = scheduleCellAddress(element);
  if (!current) return null;

  const cells = scheduleCellElements();
  const currentIndex = cells.findIndex(
    (cell) =>
      cell.dataset.scheduleRow === current.row && cell.dataset.scheduleColumn === current.column,
  );
  if (currentIndex === -1) return null;

  let candidates: HTMLElement[];
  let targetIndex: number;
  if (direction === "next" || direction === "previous") {
    candidates = cells;
    targetIndex = currentIndex + (direction === "next" ? 1 : -1);
  } else if (direction === "nextInRow" || direction === "previousInRow") {
    candidates = cells.filter((cell) => cell.dataset.scheduleRow === current.row);
    const rowIndex = candidates.findIndex((cell) => cell.dataset.scheduleColumn === current.column);
    targetIndex = rowIndex + (direction === "nextInRow" ? 1 : -1);
  } else {
    candidates = cells.filter((cell) => cell.dataset.scheduleColumn === current.column);
    const columnIndex = candidates.findIndex((cell) => cell.dataset.scheduleRow === current.row);
    targetIndex = columnIndex + (direction === "nextInColumn" ? 1 : -1);
  }

  const target = candidates[targetIndex];
  if (!target?.dataset.scheduleRow || !target.dataset.scheduleColumn) return null;
  return { row: target.dataset.scheduleRow, column: target.dataset.scheduleColumn };
}

function focusScheduleCell(address: ScheduleCellAddress, activate = true): void {
  const target = scheduleCellTarget(address);
  if (!target) return;
  target.focus();
  if (activate && target.dataset.scheduleActivate === "true") target.click();
}

export function handleScheduleGridKeyDown(event: React.KeyboardEvent<HTMLElement>): boolean {
  const direction = scheduleNavigationDirection(event);
  if (!direction) return false;
  const target = scheduleNavigationTarget(event.currentTarget, direction);
  if (!target) return false;
  event.preventDefault();
  requestAnimationFrame(() => focusScheduleCell(target));
  return true;
}

/**
 * Hands focus back to a cell's own trigger once an inline edit ends without
 * moving (Enter, Escape). `activate: false` matters: refocusing must not
 * re-open the editor the user just left, and without this the trigger the
 * input replaced is gone, so focus would fall back to <body> and the whole
 * grid would have to be re-entered by hand (H59).
 */
export function refocusScheduleCell(element: HTMLElement): void {
  const address = scheduleCellAddress(element);
  if (!address) return;
  requestAnimationFrame(() => focusScheduleCell(address, false));
}

export async function commitAndNavigate(
  event: React.KeyboardEvent<HTMLElement>,
  commit: () => Promise<boolean>,
): Promise<boolean> {
  const direction = editingNavigationDirection(event);
  if (!direction) return false;
  const target = scheduleNavigationTarget(event.currentTarget, direction);
  if (!target) return false;
  event.preventDefault();
  if (await commit()) requestAnimationFrame(() => focusScheduleCell(target));
  return true;
}
