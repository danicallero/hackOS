import DateTimePicker from "@react-native-community/datetimepicker";
import { useMemo, useState } from "react";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PressableFeedback } from "@/components/pressable-feedback";
import { SymbolView } from "@/components/symbol";
import { type WheelOption, WheelPicker } from "@/components/wheel-picker";
import {
  eventZoneHint,
  formatEventTime,
  fromPickerDate,
  toPickerDate,
  useEventTimeZone,
} from "@/lib/event-time";
import { useLocale } from "@/lib/i18n";
import { colors, radius, space, type } from "@/theme";

export interface DateTimeFieldProps {
  value: Date;
  onChange: (date: Date) => void;
  minimumDate?: Date;
  maximumDate?: Date;
  dateAccessibilityLabel: string;
  timeAccessibilityLabel: string;
}

// Props are real instants. The native pickers only speak the phone's zone, so
// they are fed an event-clock picker date (see `toPickerDate`) and what they
// return is converted back; the date and time halves are merged on the
// event's wall clock, so a DST change between them cannot skew either.
function withDatePart(base: Date, patch: Date, timeZone: string): Date {
  const next = toPickerDate(base, timeZone);
  next.setFullYear(patch.getFullYear(), patch.getMonth(), patch.getDate());
  return fromPickerDate(next, timeZone);
}

function withTimePart(base: Date, patch: Date, timeZone: string): Date {
  const next = toPickerDate(base, timeZone);
  next.setHours(patch.getHours(), patch.getMinutes());
  return fromPickerDate(next, timeZone);
}

/**
 * Unlike iOS's inline `<DateTimePicker>`, Android's isn't a widget you can
 * leave mounted — mounting it launches a system dialog as a side effect.
 * Rendering a date picker and a time picker as permanent siblings (as this
 * app assumes on iOS) pops the date dialog unprompted on Android and drops
 * the time dialog's open request, since only one native dialog can be
 * active at a time. The library's own docs recommend the imperative
 * `DateTimePickerAndroid.open()` API for Android instead — this wraps that
 * behind two tappable chips so date and time each open on demand, in turn.
 */
export function DateTimeField({
  value,
  onChange,
  minimumDate,
  maximumDate,
  dateAccessibilityLabel,
  timeAccessibilityLabel,
}: DateTimeFieldProps) {
  const timeZone = useEventTimeZone();
  const { language } = useLocale();
  const pickerValue = toPickerDate(value, timeZone);
  const pickerMin = minimumDate ? toPickerDate(minimumDate, timeZone) : undefined;
  const pickerMax = maximumDate ? toPickerDate(maximumDate, timeZone) : undefined;
  if (Platform.OS === "android") {
    return (
      <AndroidDateTimeField
        dateAccessibilityLabel={dateAccessibilityLabel}
        language={language}
        maximumDate={pickerMax}
        minimumDate={pickerMin}
        onPickerChange={(date, mode) =>
          onChange(
            mode === "date"
              ? withDatePart(value, date, timeZone)
              : withTimePart(value, date, timeZone),
          )
        }
        pickerValue={pickerValue}
        timeAccessibilityLabel={timeAccessibilityLabel}
        timeZone={timeZone}
        value={value}
      />
    );
  }

  return (
    <DateTimePicker
      value={pickerValue}
      mode="datetime"
      minimumDate={pickerMin}
      maximumDate={pickerMax}
      onValueChange={(_, date) => date && onChange(fromPickerDate(date, timeZone))}
    />
  );
}

function DateTimeChip({
  accessibilityLabel,
  icon,
  label,
  onPress,
}: {
  accessibilityLabel: string;
  icon: "calendar.badge.clock" | "clock";
  label: string;
  onPress: () => void;
}) {
  return (
    <PressableFeedback
      feedback="opacity"
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={{
        alignItems: "center",
        backgroundColor: colors.elevatedSurface,
        borderRadius: radius.chip,
        flexDirection: "row",
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      <SymbolView name={icon} size={16} tintColor={colors.accent} />
      <Text style={{ color: colors.label, fontSize: type.subhead.fontSize, fontWeight: "600" }}>
        {label}
      </Text>
    </PressableFeedback>
  );
}

const MONTHS = Array.from({ length: 12 }, (_, month) => month);

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function clampDate(date: Date, min?: Date, max?: Date) {
  if (min && date < min) return new Date(min);
  if (max && date > max) return new Date(max);
  return date;
}

/**
 * Android: two chips, each opening an iOS-style wheel sheet instead of the
 * Material date/time dialogs (H55, H59). Wheels edit the picker date (the
 * event's wall clock in device-local fields) live, like iOS's inline picker.
 */
function AndroidDateTimeField({
  value,
  pickerValue,
  minimumDate,
  maximumDate,
  onPickerChange,
  dateAccessibilityLabel,
  timeAccessibilityLabel,
  timeZone,
  language,
}: {
  value: Date;
  pickerValue: Date;
  minimumDate?: Date;
  maximumDate?: Date;
  onPickerChange: (date: Date, mode: "date" | "time") => void;
  dateAccessibilityLabel: string;
  timeAccessibilityLabel: string;
  timeZone: string;
  language: string;
}) {
  const [mode, setMode] = useState<"date" | "time" | null>(null);
  return (
    <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        <DateTimeChip
          accessibilityLabel={dateAccessibilityLabel}
          icon="calendar.badge.clock"
          label={formatEventTime(value, language, { dateStyle: "short" }, timeZone)}
          onPress={() => setMode("date")}
        />
        <DateTimeChip
          accessibilityLabel={timeAccessibilityLabel}
          icon="clock"
          label={[
            formatEventTime(value, language, { hour: "2-digit", minute: "2-digit" }, timeZone),
            eventZoneHint(language, timeZone, value.getTime()),
          ]
            .filter(Boolean)
            .join(" ")}
          onPress={() => setMode("time")}
        />
      </View>
      {mode ? (
        <WheelSheet
          date={pickerValue}
          label={mode === "date" ? dateAccessibilityLabel : timeAccessibilityLabel}
          language={language}
          maximumDate={maximumDate}
          minimumDate={minimumDate}
          mode={mode}
          onChange={(date) => onPickerChange(clampDate(date, minimumDate, maximumDate), mode)}
          onClose={() => setMode(null)}
        />
      ) : null}
    </>
  );
}

function WheelSheet({
  date,
  label,
  mode,
  minimumDate,
  maximumDate,
  language,
  onChange,
  onClose,
}: {
  date: Date;
  label: string;
  mode: "date" | "time";
  minimumDate?: Date;
  maximumDate?: Date;
  language: string;
  onChange: (date: Date) => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  const years = useMemo(() => {
    const from = minimumDate?.getFullYear() ?? date.getFullYear() - 5;
    const to = maximumDate?.getFullYear() ?? date.getFullYear() + 5;
    return Array.from(
      { length: Math.max(1, to - from + 1) },
      (_, i): WheelOption => ({
        label: String(from + i),
        value: from + i,
      }),
    );
  }, [date, minimumDate, maximumDate]);
  const monthOptions = useMemo(
    () =>
      MONTHS.map(
        (month): WheelOption => ({
          label: new Date(2000, month, 1).toLocaleDateString(language, { month: "short" }),
          value: month,
        }),
      ),
    [language],
  );
  const pad = (n: number) => String(n).padStart(2, "0");
  const set = (patch: { y?: number; m?: number; d?: number; h?: number; min?: number }) => {
    const next = new Date(date);
    const year = patch.y ?? date.getFullYear();
    const month = patch.m ?? date.getMonth();
    const day = Math.min(patch.d ?? date.getDate(), daysInMonth(year, month));
    next.setFullYear(year, month, day);
    next.setHours(patch.h ?? date.getHours(), patch.min ?? date.getMinutes());
    onChange(next);
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose} statusBarTranslucent transparent visible>
      <Pressable
        accessibilityLabel={t("close")}
        accessibilityRole="button"
        onPress={onClose}
        style={{ backgroundColor: colors.scrim, flex: 1 }}
      />
      <View
        style={{
          backgroundColor: colors.background,
          borderCurve: "continuous",
          borderTopLeftRadius: radius.sheet,
          borderTopRightRadius: radius.sheet,
          paddingBottom: insets.bottom + space.lg,
          paddingHorizontal: space.lg,
        }}
      >
        <View style={{ alignItems: "flex-end", height: 48, justifyContent: "center" }}>
          <PressableFeedback accessibilityRole="button" hitSlop={8} onPress={onClose}>
            <Text style={{ ...type.headline, color: colors.accent }}>{t("close")}</Text>
          </PressableFeedback>
        </View>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          {mode === "date" ? (
            <>
              <WheelPicker
                accessibilityLabel={label}
                onChange={(i) => set({ d: i + 1 })}
                options={Array.from(
                  { length: daysInMonth(date.getFullYear(), date.getMonth()) },
                  (_, i): WheelOption => ({ label: String(i + 1), value: i + 1 }),
                )}
                selectedIndex={date.getDate() - 1}
              />
              <WheelPicker
                accessibilityLabel={label}
                flex={1.4}
                onChange={(i) => set({ m: i })}
                options={monthOptions}
                selectedIndex={date.getMonth()}
              />
              <WheelPicker
                accessibilityLabel={label}
                flex={1.2}
                onChange={(i) => set({ y: years[i]?.value })}
                options={years}
                selectedIndex={Math.max(
                  0,
                  years.findIndex((y) => y.value === date.getFullYear()),
                )}
              />
            </>
          ) : (
            <>
              <WheelPicker
                accessibilityLabel={label}
                onChange={(i) => set({ h: i })}
                options={Array.from(
                  { length: 24 },
                  (_, i): WheelOption => ({ label: pad(i), value: i }),
                )}
                selectedIndex={date.getHours()}
              />
              <WheelPicker
                accessibilityLabel={label}
                onChange={(i) => set({ min: i })}
                options={Array.from(
                  { length: 60 },
                  (_, i): WheelOption => ({ label: pad(i), value: i }),
                )}
                selectedIndex={date.getMinutes()}
              />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}
