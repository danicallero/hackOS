export interface CertaintyWindowLike {
  start: string;
  deadline: string;
  securedUntil: string | null;
}

export function durationMinutes(start: string, end: string): number {
  const duration = Date.parse(end) - Date.parse(start);
  return Number.isFinite(duration) ? Math.max(0, Math.round(duration / 60_000)) : 0;
}

export function securedWindowFraction(window: CertaintyWindowLike): number {
  if (!window.securedUntil) return 0;
  const total = Date.parse(window.deadline) - Date.parse(window.start);
  const secured = Date.parse(window.securedUntil) - Date.parse(window.start);
  if (!Number.isFinite(total) || !Number.isFinite(secured) || total <= 0) return 0;
  return Math.min(1, Math.max(0, secured / total));
}
