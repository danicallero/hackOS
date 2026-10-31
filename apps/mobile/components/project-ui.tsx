import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { AppActivityIndicator } from "@/components/app-activity-indicator";
import { GlassView } from "@/components/glass-view";
import { PressableFeedback } from "@/components/pressable-feedback";
import { SymbolView, type SymbolViewProps } from "@/components/symbol";
import { colors, MIN_TARGET, radius, space, type } from "@/theme";

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
    <PressableFeedback
      feedback="row"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, ...lines, value].filter(Boolean).join(", ")}
      onPress={onPress}
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: space.md,
        minHeight: 56,
        paddingHorizontal: space.lg,
        paddingVertical: space.row,
      }}
    >
      {icon ? (
        <SymbolView name={icon} tintColor={colors.accent} size={22} accessible={false} />
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ alignItems: "baseline", flexDirection: "row", gap: 12 }}>
          <Text style={[type.body, { color: colors.label, flex: 1 }]}>{title}</Text>
          {value ? (
            <Text style={[type.subhead, { color: colors.secondaryLabel }]}>{value}</Text>
          ) : null}
        </View>
        {lines.map((line) => (
          <Text key={line} style={[type.compact, { color: colors.secondaryLabel }]}>
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
    </PressableFeedback>
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
        <Text
          style={{ color: colors.secondaryLabel, flexShrink: 1, fontSize: type.footnote.fontSize }}
        >
          {label}
        </Text>
        {required ? (
          <Text style={{ color: colors.secondaryLabel, fontSize: type.footnote.fontSize }}>
            {required}
          </Text>
        ) : null}
      </View>
      {children}
      {hint ? (
        <Text style={{ color: colors.secondaryLabel, fontSize: type.footnote.fontSize }}>
          {hint}
        </Text>
      ) : null}
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
    <PressableFeedback
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{ justifyContent: "center", minHeight: MIN_TARGET, paddingHorizontal: space.xxs }}
    >
      <Text style={[type.headline, { color: destructive ? colors.destructive : colors.accent }]}>
        {label}
      </Text>
    </PressableFeedback>
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
        { borderCurve: "continuous", borderRadius: radius.full, opacity: disabled ? 0.45 : 1 },
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
          <AppActivityIndicator color={prominent ? colors.primaryActionText : colors.accent} />
        ) : null}
        <Text
          style={{
            color: prominent ? colors.primaryActionText : colors.accent,
            fontSize: type.body.fontSize,
            fontWeight: "600",
          }}
        >
          {label}
        </Text>
      </Pressable>
    </GlassView>
  );
}

/** Round header button of the sheets (close, confirm, add), as in Photos. */
export function CircleButton({
  icon,
  label,
  onPress,
  disabled = false,
  prominent = false,
  filled = false,
  size = 44,
}: {
  icon: "xmark" | "checkmark" | "plus";
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** The confirm button turns accent blue once it can act, as in Photos. */
  prominent?: boolean;
  /** A quiet filled circle (the add button). */
  filled?: boolean;
  size?: number;
}) {
  const active = prominent && !disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={{
        alignItems: "center",
        backgroundColor: active ? colors.accent : filled ? colors.elevatedSurface : undefined,
        borderRadius: size / 2,
        height: size,
        justifyContent: "center",
        width: size,
      }}
    >
      <SymbolView
        name={icon}
        tintColor={
          active ? colors.primaryActionText : disabled ? colors.tertiaryLabel : colors.label
        }
        size={size > 36 ? 19 : 16}
        weight="semibold"
        accessible={false}
      />
    </Pressable>
  );
}
