"use client";

// H45/H47: every time the app shows or accepts is the EVENT's wall clock (the
// event_config timezone, delivered on GET /api/me as `eventTimezone`), never
// the browser's. SessionProvider publishes the zone here once; the datetime
// helpers read it so non-React code (CSV export, form defaults) agrees with
// what the roster shows. Until it is known the browser zone stands in.

import { deviceTimeZone, isValidTimeZone, zoneAbbreviation } from "@hackos/shared/event-time";
import { useSyncExternalStore } from "react";

let eventZone: string | null = null;
const listeners = new Set<() => void>();

export function setEventTimeZone(zone: string | null | undefined): void {
  const next = isValidTimeZone(zone) ? zone : null;
  if (next === eventZone) return;
  eventZone = next;
  for (const listener of listeners) listener();
}

/** The event's IANA zone, or the browser's while it is not yet known. */
export function getEventTimeZone(): string {
  return eventZone ?? deviceTimeZone();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders the caller when the event zone changes. */
export function useEventTimeZone(): string {
  return useSyncExternalStore(subscribe, getEventTimeZone, getEventTimeZone);
}

/**
 * Terse zone name ("CEST") to show beside a time, only when the event zone
 * differs from the browser's: otherwise the clock on the wall is the clock on
 * the screen and the label would be noise. "" when not needed.
 */
export function useEventZoneHint(locale?: string): string {
  const zone = useEventTimeZone();
  if (zone === deviceTimeZone()) return "";
  return zoneAbbreviation(zone, locale);
}
