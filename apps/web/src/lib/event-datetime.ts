/**
 * `<input type="datetime-local">` carries NO timezone: its value is a bare
 * wall-clock string. This does a straightforward conversion between that and
 * the API's ISO instant using the *browser's* local zone. Caveat: if the
 * operator's machine isn't on the event's timezone, the displayed wall-clock
 * won't match the event zone — `ZonedTimePreview` surfaces that reading
 * alongside the field so it's never a silent mismatch.
 */
export function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
