import { useState } from "react";
import { Pressable, View } from "react-native";
import { PressableFeedback } from "@/components/pressable-feedback";
import { SymbolView } from "@/components/symbol";
import {
  type AvailabilityInterval,
  clockRange,
  DAY_MINUTES,
  dayPieces,
  minuteAt,
  minutesBefore,
  type PlanDay,
} from "@/lib/help-desk";
import { useLocale } from "@/lib/i18n";
import { colors, radius } from "@/theme";
import { AppText } from "../app-text";

const TRACK_HEIGHT = 40;
const percent = (minutes: number) => `${(minutes / DAY_MINUTES) * 100}%` as const;

/**
 * Planned availability (H62) as the web shows it: one 24-hour line per event
 * day with the stated stretches marked, the time before hacking dimmed, and
 * the hours beneath the last line. A touch on a free spot starts a stretch
 * there, a touch on a stretch opens it; each day's plus adds one at the usual
 * hour. A stretch crossing midnight continues on the next day's line.
 */
export function AvailabilityTimeline({
  days,
  intervals,
  notBefore,
  onAdd,
  onEdit,
}: {
  days: PlanDay[];
  intervals: AvailabilityInterval[];
  /** Instant before which nobody can be available (the start of hacking). */
  notBefore?: string | null;
  /** `minute` is the touched time of the day, or null from the day's plus. */
  onAdd: (day: PlanDay, minute: number | null) => void;
  onEdit: (index: number) => void;
}) {
  const { t, language } = useLocale();
  const [width, setWidth] = useState(0);
  return (
    <View style={{ gap: 16, paddingHorizontal: 16, paddingVertical: 14 }}>
      {days.map((day) => {
        const pieces = dayPieces(intervals, day.key);
        const dimmed = minutesBefore(day.key, notBefore);
        // Each stretch is named once, on the day it starts.
        const summary = pieces
          .filter((piece) => !piece.fromPrev)
          .map((piece) => clockRange(piece.interval, language))
          .join(", ");
        return (
          <View key={day.key} style={{ gap: 8 }}>
            <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
              <AppText variant="subhead" style={{ fontWeight: "600" }}>
                {day.label}
              </AppText>
              <AppText
                variant="subhead"
                tone="secondary"
                numberOfLines={1}
                style={{ flex: 1, fontVariant: ["tabular-nums"], textAlign: "right" }}
              >
                {summary}
              </AppText>
              <PressableFeedback
                feedback="opacity"
                accessibilityRole="button"
                accessibilityLabel={`${t("helpAddInterval")}, ${day.label}`}
                hitSlop={12}
                onPress={() => onAdd(day, null)}
              >
                <SymbolView name="plus.circle.fill" size={24} tintColor={colors.accent} />
              </PressableFeedback>
            </View>
            <Pressable
              accessible={false}
              onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
              onPress={(event) => onAdd(day, minuteAt(event.nativeEvent.locationX, width))}
              style={{
                backgroundColor: colors.elevatedSurface,
                borderCurve: "continuous",
                borderRadius: radius.chip,
                height: TRACK_HEIGHT,
                overflow: "hidden",
              }}
            >
              {dimmed > 0 ? (
                <View
                  pointerEvents="none"
                  style={{
                    backgroundColor: colors.separator,
                    bottom: 0,
                    left: 0,
                    opacity: 0.6,
                    position: "absolute",
                    top: 0,
                    width: percent(dimmed),
                  }}
                />
              ) : null}
              {[6, 12, 18].map((hour) => (
                <View
                  key={hour}
                  pointerEvents="none"
                  style={{
                    backgroundColor: colors.separator,
                    bottom: 0,
                    left: percent(hour * 60),
                    position: "absolute",
                    top: 0,
                    width: 1,
                  }}
                />
              ))}
              {pieces.map((piece) => (
                <Pressable
                  key={piece.index}
                  accessibilityRole="button"
                  accessibilityLabel={`${day.label}, ${clockRange(piece.interval, language)}`}
                  // A half-hour stretch is only a few points wide.
                  hitSlop={{ bottom: 4, left: 8, right: 8, top: 4 }}
                  onPress={() => onEdit(piece.index)}
                  style={{
                    backgroundColor: colors.accent,
                    borderBottomLeftRadius: piece.fromPrev ? 0 : 6,
                    borderBottomRightRadius: piece.toNext ? 0 : 6,
                    borderCurve: "continuous",
                    borderTopLeftRadius: piece.fromPrev ? 0 : 6,
                    borderTopRightRadius: piece.toNext ? 0 : 6,
                    bottom: 4,
                    left: percent(piece.start),
                    position: "absolute",
                    top: 4,
                    width: percent(piece.end - piece.start),
                  }}
                />
              ))}
            </Pressable>
          </View>
        );
      })}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ flexDirection: "row", justifyContent: "space-between", marginTop: -8 }}
      >
        {[0, 6, 12, 18, 24].map((hour) => (
          <AppText key={hour} variant="caption" tone="secondary">
            {hour}
          </AppText>
        ))}
      </View>
    </View>
  );
}
