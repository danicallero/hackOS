import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { Platform, Pressable, Text, View } from "react-native";
import { SymbolView } from "@/components/symbol";
import { colors } from "@/theme/colors";

export interface DateTimeFieldProps {
  value: Date;
  onChange: (date: Date) => void;
  minimumDate?: Date;
  maximumDate?: Date;
  dateAccessibilityLabel: string;
  timeAccessibilityLabel: string;
}

function withDatePart(base: Date, patch: Date): Date {
  const next = new Date(base);
  next.setFullYear(patch.getFullYear(), patch.getMonth(), patch.getDate());
  return next;
}

function withTimePart(base: Date, patch: Date): Date {
  const next = new Date(base);
  next.setHours(patch.getHours(), patch.getMinutes());
  return next;
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
  if (Platform.OS === "android") {
    const openPicker = (mode: "date" | "time") => {
      DateTimePickerAndroid.open({
        value,
        mode,
        minimumDate,
        maximumDate,
        onValueChange: (_, date) => {
          if (!date) return;
          onChange(mode === "date" ? withDatePart(value, date) : withTimePart(value, date));
        },
      });
    };
    return (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <DateTimeChip
          accessibilityLabel={dateAccessibilityLabel}
          icon="calendar.badge.clock"
          label={value.toLocaleDateString()}
          onPress={() => openPicker("date")}
        />
        <DateTimeChip
          accessibilityLabel={timeAccessibilityLabel}
          icon="clock"
          label={value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          onPress={() => openPicker("time")}
        />
      </View>
    );
  }

  return (
    <DateTimePicker
      value={value}
      mode="datetime"
      minimumDate={minimumDate}
      maximumDate={maximumDate}
      onValueChange={(_, date) => date && onChange(date)}
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
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: colors.elevatedSurface,
        borderRadius: 10,
        flexDirection: "row",
        gap: 6,
        opacity: pressed ? 0.6 : 1,
        paddingHorizontal: 12,
        paddingVertical: 10,
      })}
    >
      <SymbolView name={icon} size={16} tintColor={colors.accent} />
      <Text style={{ color: colors.label, fontSize: 15, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}
