export function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDatetimeLocal(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const dateTimeLocalPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;
const displayDateTimePattern = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})$/;

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatScheduledDateTime(value: string): string {
  const localMatch = dateTimeLocalPattern.exec(value);
  if (localMatch) {
    const [, year, month, day, hour, minute] = localMatch;
    return `${day}/${month}/${year} ${hour}:${minute}`;
  }

  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : `${padDatePart(d.getDate())}/${padDatePart(d.getMonth() + 1)}/${d.getFullYear()} ${padDatePart(d.getHours())}:${padDatePart(d.getMinutes())}`;
}

export function parseScheduledDateTime(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const localMatch = dateTimeLocalPattern.exec(trimmed);
  if (localMatch) {
    return `${localMatch[1]}-${localMatch[2]}-${localMatch[3]}T${localMatch[4]}:${localMatch[5]}`;
  }

  const match = displayDateTimePattern.exec(trimmed);
  if (!match) return null;

  const [, dayRaw, monthRaw, yearRaw, hourRaw, minuteRaw] = match;
  const day = Number(dayRaw);
  const month = Number(monthRaw);
  const year = Number(yearRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return null;
  }

  const parsed = new Date(year, month - 1, day, hour, minute);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute
  ) {
    return null;
  }

  return `${year}-${padDatePart(month)}-${padDatePart(day)}T${padDatePart(hour)}:${padDatePart(minute)}`;
}
