import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { GlassView } from "@/components/glass-view";
import { SymbolView, type SymbolViewProps } from "@/components/symbol";
import { colors } from "@/theme/colors";

/**
 * Inset-grouped list row in the Settings/Mail mould: title, optional
 * secondary lines beneath it, a trailing value and a disclosure chevron.
 * Heights grow with Dynamic Type; nothing here has a fixed height.
 */
export function NavRow({
  title,
  lines = [],
  value,
  icon,
  onPress,
  accessibilityLabel,
  chevron = true,
}: {
  title: string;
  lines?: string[];
  value?: string;
  icon?: SymbolViewProps["name"];
  onPress: () => void;
  accessibilityLabel?: string;
  chevron?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, ...lines, value].filter(Boolean).join(", ")}
      onPress={onPress}
      style={({ pressed }) => ({
        alignItems: "center",
        backgroundColor: pressed ? colors.elevatedSurface : "transparent",
        flexDirection: "row",
        gap: 12,
        minHeight: 56,
        paddingHorizontal: 16,
        paddingVertical: 10,
      })}
    >
      {icon ? (
        <SymbolView name={icon} tintColor={colors.accent} size={22} accessible={false} />
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ alignItems: "baseline", flexDirection: "row", gap: 12 }}>
          <Text style={{ color: colors.label, flex: 1, fontSize: 17 }}>{title}</Text>
          {value ? (
            <Text style={{ color: colors.secondaryLabel, fontSize: 15 }}>{value}</Text>
          ) : null}
        </View>
        {lines.map((line) => (
          <Text key={line} style={{ color: colors.secondaryLabel, fontSize: 14 }}>
            {line}
          </Text>
        ))}
      </View>
      {chevron ? (
        <SymbolView
          name="chevron.right"
          tintColor={colors.tertiaryLabel}
          size={12}
          weight="semibold"
          accessible={false}
        />
      ) : null}
    </Pressable>
  );
}

/** A form row: small caption above a borderless native input, as in Reminders or Contacts. */
export function FieldRow({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: 4, minHeight: 56, paddingHorizontal: 16, paddingVertical: 10 }}>
      <View style={{ flexDirection: "row", gap: 8, justifyContent: "space-between" }}>
        <Text style={{ color: colors.secondaryLabel, flexShrink: 1, fontSize: 13 }}>{label}</Text>
        {required ? (
          <Text style={{ color: colors.tertiaryLabel, fontSize: 13 }}>{required}</Text>
        ) : null}
      </View>
      {children}
      {hint ? <Text style={{ color: colors.secondaryLabel, fontSize: 13 }}>{hint}</Text> : null}
    </View>
  );
}

/** Trailing text button inside a row (Reminders "Add", Mail "Send"). */
export function RowButton({
  label,
  onPress,
  disabled = false,
  destructive = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        justifyContent: "center",
        minHeight: 44,
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
        paddingHorizontal: 4,
      })}
    >
      <Text
        style={{
          color: destructive ? colors.destructive : colors.accent,
          fontSize: 17,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Liquid Glass capsule button. `prominent` tints the glass with the accent for
 * the one primary action on a screen; the rest stay neutral glass.
 */
export function GlassButton({
  label,
  onPress,
  disabled = false,
  busy = false,
  prominent = false,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  prominent?: boolean;
  style?: object;
}) {
  const inactive = disabled || busy;
  return (
    <GlassView
      colorScheme="auto"
      glassEffectStyle="regular"
      isInteractive={!inactive}
      tintColor={prominent ? colors.accent : undefined}
      style={[
        { borderCurve: "continuous", borderRadius: 999, opacity: disabled ? 0.45 : 1 },
        style,
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: inactive, busy }}
        disabled={inactive}
        onPress={onPress}
        style={{
          alignItems: "center",
          flexDirection: "row",
          gap: 8,
          justifyContent: "center",
          minHeight: 52,
          paddingHorizontal: 20,
        }}
      >
        {busy ? (
          <ActivityIndicator color={prominent ? colors.primaryActionText : colors.accent} />
        ) : null}
        <Text
          style={{
            color: prominent ? colors.primaryActionText : colors.accent,
            fontSize: 17,
            fontWeight: "600",
          }}
        >
          {label}
        </Text>
      </Pressable>
    </GlassView>
  );
}
