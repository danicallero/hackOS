"use client";

/**
 * Spreadsheet-style keyboard navigation for editable tables (H46, H59).
 *
 * The DOM half is shared by operational tables while each surface can keep
 * its own data prefix and save rules. A cell owns one focusable trigger; the
 * helper moves with Tab/arrows and returns focus after an inline editor saves.
 */

export type EditableTableNavigationDirection =
  | "next"
  | "previous"
  | "nextInRow"
  | "previousInRow"
  | "nextInColumn"
  | "previousInColumn";

type DirectionReader = (event: {
  key: string;
  shiftKey?: boolean;
}) => EditableTableNavigationDirection | null;

type CellAddress = { row: string; column: string };

function dataAttribute(prefix: string, part: "cell" | "row" | "column"): string {
  return `data-${prefix}-${part}`;
}

function cellAddress(element: HTMLElement, prefix: string): CellAddress | null {
  const cell = element.closest<HTMLElement>(`[${dataAttribute(prefix, "cell")}="true"]`);
  const rowKey = dataAttribute(prefix, "row");
  const columnKey = dataAttribute(prefix, "column");
  if (!cell?.getAttribute(rowKey) || !cell.getAttribute(columnKey)) return null;
  return { row: cell.getAttribute(rowKey) ?? "", column: cell.getAttribute(columnKey) ?? "" };
}

function cellElements(prefix: string): HTMLElement[] {
  const cellKey = dataAttribute(prefix, "cell");
  const focusableKey = `data-${prefix}-focusable`;
  return Array.from(document.querySelectorAll<HTMLElement>(`[${cellKey}="true"]`)).filter(
    (cell) => {
      const target = cell.querySelector<HTMLElement>(`[${focusableKey}="true"]`);
      return target !== null && !target.hasAttribute("disabled");
    },
  );
}

function navigationTarget(
  element: HTMLElement,
  direction: EditableTableNavigationDirection,
  prefix: string,
): CellAddress | null {
  const current = cellAddress(element, prefix);
  if (!current) return null;

  const cells = cellElements(prefix);
  const currentIndex = cells.findIndex((cell) => {
    const rowKey = dataAttribute(prefix, "row");
    const columnKey = dataAttribute(prefix, "column");
    return (
      cell.getAttribute(rowKey) === current.row && cell.getAttribute(columnKey) === current.column
    );
  });
  if (currentIndex === -1) return null;

  let candidates: HTMLElement[];
  let targetIndex: number;
  const rowKey = dataAttribute(prefix, "row");
  const columnKey = dataAttribute(prefix, "column");
  if (direction === "next" || direction === "previous") {
    candidates = cells;
    targetIndex = currentIndex + (direction === "next" ? 1 : -1);
  } else if (direction === "nextInRow" || direction === "previousInRow") {
    candidates = cells.filter((cell) => cell.getAttribute(rowKey) === current.row);
    const rowIndex = candidates.findIndex(
      (cell) => cell.getAttribute(columnKey) === current.column,
    );
    targetIndex = rowIndex + (direction === "nextInRow" ? 1 : -1);
  } else {
    candidates = cells.filter((cell) => cell.getAttribute(columnKey) === current.column);
    const columnIndex = candidates.findIndex((cell) => cell.getAttribute(rowKey) === current.row);
    targetIndex = columnIndex + (direction === "nextInColumn" ? 1 : -1);
  }

  const target = candidates[targetIndex];
  if (!target?.getAttribute(rowKey) || !target.getAttribute(columnKey)) return null;
  return {
    row: target.getAttribute(rowKey) ?? "",
    column: target.getAttribute(columnKey) ?? "",
  };
}

function focusCell(address: CellAddress, prefix: string, activate = true): void {
  const rowKey = dataAttribute(prefix, "row");
  const columnKey = dataAttribute(prefix, "column");
  const cell = cellElements(prefix).find(
    (candidate) =>
      candidate.getAttribute(rowKey) === address.row &&
      candidate.getAttribute(columnKey) === address.column,
  );
  const target = cell?.querySelector<HTMLElement>(`[data-${prefix}-focusable="true"]`);
  if (!target) return;
  target.focus();
  if (activate && target.getAttribute(`data-${prefix}-activate`) === "true") target.click();
}

export function editableTableNavigationDirection(event: {
  key: string;
  shiftKey?: boolean;
}): EditableTableNavigationDirection | null {
  if (event.key === "Tab") return event.shiftKey ? "previous" : "next";
  if (event.key === "ArrowLeft") return "previousInRow";
  if (event.key === "ArrowRight") return "nextInRow";
  if (event.key === "ArrowUp") return "previousInColumn";
  if (event.key === "ArrowDown") return "nextInColumn";
  return null;
}

/** Left/right stay with the text caret while a cell's input is open. */
export function editableTableEditingNavigationDirection(event: {
  key: string;
  shiftKey?: boolean;
}): EditableTableNavigationDirection | null {
  const direction = editableTableNavigationDirection(event);
  return direction === "nextInRow" || direction === "previousInRow" ? null : direction;
}

export function handleEditableTableGridKeyDown(
  event: React.KeyboardEvent<HTMLElement>,
  prefix: string,
  readDirection: DirectionReader = editableTableNavigationDirection,
): boolean {
  const direction = readDirection(event);
  if (!direction) return false;
  const target = navigationTarget(event.currentTarget, direction, prefix);
  if (!target) return false;
  event.preventDefault();
  requestAnimationFrame(() => focusCell(target, prefix));
  return true;
}

export function refocusEditableTableCell(element: HTMLElement, prefix: string): void {
  const address = cellAddress(element, prefix);
  if (!address) return;
  requestAnimationFrame(() => focusCell(address, prefix, false));
}

export async function commitAndNavigateEditableTableCell(
  event: React.KeyboardEvent<HTMLElement>,
  prefix: string,
  commit: () => Promise<boolean>,
  readDirection: DirectionReader = editableTableEditingNavigationDirection,
): Promise<boolean> {
  const direction = readDirection(event);
  if (!direction) return false;
  const target = navigationTarget(event.currentTarget, direction, prefix);
  if (!target) return false;
  event.preventDefault();
  if (await commit()) requestAnimationFrame(() => focusCell(target, prefix));
  return true;
}
