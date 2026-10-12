import { fromDatetimeLocal, toDatetimeLocal } from "./datetime";
import { getEventTimeZone } from "./event-time";

/**
 * `<input type="datetime-local">` carries NO timezone: its value is a bare
 * wall-clock string. Event settings read and write it in the event's zone
 * (H45/H47), by default the saved one; the settings form passes the zone it
 * is currently editing so a changed Timezone field reinterprets the same
 * wall clock rather than the browser's.
 */
export function toLocalInputValue(
  iso: string | null,
  timeZone: string = getEventTimeZone(),
): string {
  return toDatetimeLocal(iso, false, timeZone);
}

export function fromLocalInputValue(
  value: string,
  timeZone: string = getEventTimeZone(),
): string | null {
  return fromDatetimeLocal(value, timeZone);
}
