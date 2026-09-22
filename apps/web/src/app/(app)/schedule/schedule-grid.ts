// Spreadsheet-style keyboard navigation for the Manage Schedule grid (H59).
//
// This is the DOM half of the behaviour — it walks the rendered cells by their
// `data-schedule-*` attributes — while the pure "which way does this key move
// the focus" half lives in schedule-model.ts and is unit-tested there.

import {
  commitAndNavigateEditableTableCell,
  handleEditableTableGridKeyDown,
  refocusEditableTableCell,
} from "@/components/common/editable-table-grid";
import { editingNavigationDirection, scheduleNavigationDirection } from "./schedule-model";

export function handleScheduleGridKeyDown(event: React.KeyboardEvent<HTMLElement>): boolean {
  return handleEditableTableGridKeyDown(event, "schedule", scheduleNavigationDirection);
}

/**
 * Hands focus back to a cell's own trigger once an inline edit ends without
 * moving (Enter, Escape). `activate: false` matters: refocusing must not
 * re-open the editor the user just left, and without this the trigger the
 * input replaced is gone, so focus would fall back to <body> and the whole
 * grid would have to be re-entered by hand (H59).
 */
export function refocusScheduleCell(element: HTMLElement): void {
  refocusEditableTableCell(element, "schedule");
}

export async function commitAndNavigate(
  event: React.KeyboardEvent<HTMLElement>,
  commit: () => Promise<boolean>,
): Promise<boolean> {
  return commitAndNavigateEditableTableCell(event, "schedule", commit, editingNavigationDirection);
}
