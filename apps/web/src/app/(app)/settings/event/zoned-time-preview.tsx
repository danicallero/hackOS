"use client";

// Beside every date/time field: what that instant reads as in the event's
// configured timezone, so an operator editing from a machine in a different
// zone never has to do the arithmetic themselves (settings audit: "show
// local time and event-zone preview beside date/time configuration").

import { LOCALE_CODES, useLocale } from "@/lib/i18n";

export function ZonedTimePreview({ value, timezone }: { value: string; timezone: string }) {
  const { t, language } = useLocale();
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const eventReading = formatInZone(date, timezone, LOCALE_CODES[language]);
  const sameZone = browserZone === timezone;

  return (
    <p className="text-muted-foreground text-xs">
      {sameZone
        ? t("zonedTimeSameZone", { zone: timezone })
        : t("zonedTimePreview", { zone: timezone, reading: eventReading })}
    </p>
  );
}

function formatInZone(date: Date, timezone: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  } catch {
    return date.toISOString();
  }
}
