import { View } from "react-native";
import { eventDayKey, formatEventTime } from "@/lib/event-time";
import type { CoverageReport } from "@/lib/help-desk";
import { colors } from "@/theme";
import { AppText } from "../app-text";

const HEIGHT = 56;

/** The event-zone hour (0-23) of an instant. */
function hourOf(iso: string): number {
  return Number(formatEventTime(iso, "en", { hour: "numeric", hourCycle: "h23" })) % 24;
}

/**
 * H67: one day as a 24-hour strip. A bar per scheduled hour is as tall as the
 * number of people scheduled (relative to the busiest hour of the event); an
 * hour inside the event with nobody scheduled is a tinted full-height gap;
 * hours outside the event stay empty. The marker is the current hour.
 */
export function CoverageDayStrip({
  slots,
  dayKey,
  max,
  now = Date.now(),
}: {
  slots: CoverageReport["slots"];
  dayKey: string;
  max: number;
  now?: number;
}) {
  const hours = new Map<number, number>();
  for (const slot of slots) {
    if (eventDayKey(slot.startsAt) === dayKey) hours.set(hourOf(slot.startsAt), slot.scheduled);
  }
  const today = eventDayKey(now) === dayKey;
  const nowHour = today ? hourOf(new Date(now).toISOString()) : null;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={[...hours.entries()]
        .map(([hour, count]) => `${hour}:00 ${count}`)
        .join(", ")}
      style={{ gap: 4 }}
    >
      <View style={{ flexDirection: "row", gap: 2, height: HEIGHT }}>
        {Array.from({ length: 24 }, (_, hour) => {
          const scheduled = hours.get(hour);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: the 24 hours are fixed positions.
            <View key={hour} style={{ flex: 1, justifyContent: "flex-end" }}>
              {scheduled === undefined ? (
                <View
                  style={{
                    backgroundColor: colors.separator,
                    height: 2,
                  }}
                />
              ) : scheduled === 0 ? (
                <View
                  style={{
                    backgroundColor: colors.warning,
                    height: HEIGHT,
                    opacity: 0.3,
                  }}
                />
              ) : (
                <View
                  style={{
                    backgroundColor: colors.accent,
                    height: Math.max(6, (HEIGHT * scheduled) / Math.max(1, max)),
                  }}
                />
              )}
              {hour === nowHour ? (
                <View
                  style={{
                    backgroundColor: colors.label,
                    bottom: 0,
                    height: HEIGHT,
                    left: "50%",
                    position: "absolute",
                    width: 2,
                  }}
                />
              ) : null}
            </View>
          );
        })}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        {[0, 6, 12, 18, 24].map((hour) => (
          <AppText key={hour} variant="caption" tone="secondary">
            {hour}
          </AppText>
        ))}
      </View>
    </View>
  );
}
