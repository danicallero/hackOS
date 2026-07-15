import { GlassView } from "expo-glass-effect";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";

import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

export function Section({
  title,
  footer,
  children,
}: {
  title?: string;
  footer?: string;
  children: ReactNode;
}) {
  return (
    <View style={{ gap: 8 }}>
      {title ? (
        <Text
          selectable
          style={{
            color: colors.secondaryLabel,
            fontSize: 13,
            fontWeight: "600",
            paddingHorizontal: 16,
          }}
        >
          {title.toLocaleUpperCase()}
        </Text>
      ) : null}
      <View
        style={{
          backgroundColor: colors.surface,
          borderCurve: "continuous",
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        {children}
      </View>
      {footer ? (
        <Text
          selectable
          style={{
            color: colors.secondaryLabel,
            fontSize: 13,
            lineHeight: 18,
            paddingHorizontal: 16,
          }}
        >
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

export function Separator({ inset = 16, trailingInset = 0 }: { inset?: number; trailingInset?: number }) {
  return (
    <View
      style={{
        backgroundColor: colors.separator,
        height: 0.5,
        marginLeft: inset,
        marginRight: trailingInset,
      }}
    />
  );
}

export function InfoRow({
  label,
  value,
  icon,
  accessoryIcon,
  valueStyle,
}: {
  label: string;
  value: string;
  icon?: SymbolViewProps["name"];
  accessoryIcon?: SymbolViewProps["name"];
  valueStyle?: TextStyle;
}) {
  return (
    <View
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: 12,
        minHeight: 50,
        paddingHorizontal: 16,
        paddingVertical: 10,
      }}
    >
      {icon ? (
        <SymbolView name={icon} tintColor={colors.accent} size={20} accessible={false} />
      ) : null}
      <Text selectable style={{ color: colors.label, flex: 1, fontSize: 16 }}>
        {label}
      </Text>
      <Text
        selectable
        style={[
          { color: colors.secondaryLabel, flexShrink: 1, fontSize: 16, textAlign: "right" },
          valueStyle,
        ]}
      >
        {value}
      </Text>
      {accessoryIcon ? (
        <SymbolView
          name={accessoryIcon}
          tintColor={colors.tertiaryLabel}
          size={12}
          weight="semibold"
          accessible={false}
        />
      ) : null}
    </View>
  );
}

export function StatusPill({
  children,
  tone = "neutral",
  style,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "success" | "warning" | "destructive";
  /**
   * Defaults to `alignSelf: "flex-start"` so the pill doesn't stretch to
   * fill a parent that defaults to `alignItems: "stretch"` (e.g. a bare
   * flex-wrap row of chips). Pass `{ alignSelf: "center" }` when the pill
   * sits inline as a direct sibling of other centered content (icons,
   * chevrons) in a row that already sets `alignItems: "center"` — otherwise
   * this default overrides that and the pill visibly drifts to the top.
   */
  style?: ViewStyle;
}) {
  const palette = {
    neutral: { background: colors.elevatedSurface, foreground: colors.secondaryLabel },
    accent: { background: colors.accentSurface, foreground: colors.accent },
    success: { background: colors.successSurface, foreground: colors.success },
    warning: { background: colors.warningSurface, foreground: colors.warning },
    destructive: { background: colors.destructiveSurface, foreground: colors.destructive },
  }[tone];
  return (
    <View
      style={[
        {
          alignSelf: "flex-start",
          backgroundColor: palette.background,
          borderCurve: "continuous",
          borderRadius: 999,
          paddingHorizontal: 10,
          paddingVertical: 5,
        },
        style,
      ]}
    >
      <Text selectable style={{ color: palette.foreground, fontSize: 12, fontWeight: "700" }}>
        {children}
      </Text>
    </View>
  );
}

export function ActionButton({
  label,
  onPress,
  disabled = false,
  busy = false,
  destructive = false,
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  destructive?: boolean;
  icon?: SymbolViewProps["name"];
  style?: ViewStyle;
}) {
  const foreground = destructive ? colors.destructive : colors.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        {
          alignItems: "center",
          flexDirection: "row",
          gap: 8,
          justifyContent: "center",
          minHeight: 50,
          opacity: disabled || busy ? 0.45 : pressed ? 0.6 : 1,
          paddingHorizontal: 16,
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={foreground} />
      ) : icon ? (
        <SymbolView name={icon} tintColor={foreground} size={18} accessible={false} />
      ) : null}
      <Text style={{ color: foreground, fontSize: 16, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

/** Floating chrome-less icon button for header-less detail screens (position it with `top: insets.top + 12`). */
export function FloatingGlassButton({
  top,
  side = "left",
  icon,
  tintColor,
  accessibilityLabel,
  accessibilityState,
  disabled = false,
  onPress,
}: {
  top: number;
  side?: "left" | "right";
  icon: SymbolViewProps["name"];
  tintColor?: SymbolViewProps["tintColor"];
  accessibilityLabel: string;
  accessibilityState?: { selected?: boolean; busy?: boolean };
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <GlassView
      glassEffectStyle="regular"
      isInteractive
      style={{
        borderRadius: 22,
        height: 44,
        position: "absolute",
        top,
        width: 44,
        ...(side === "left" ? { left: 16 } : { right: 16 }),
      }}
    >
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={accessibilityState}
        disabled={disabled}
        onPress={onPress}
        style={{
          alignItems: "center",
          flex: 1,
          justifyContent: "center",
          opacity: disabled ? 0.4 : 1,
        }}
      >
        <SymbolView name={icon} tintColor={tintColor ?? colors.label} size={19} weight="semibold" />
      </Pressable>
    </GlassView>
  );
}

/** Floating chrome-less back button for header-less detail screens (position it with `top: insets.top + 12`). */
export function FloatingBackButton({ top, onPress }: { top: number; onPress: () => void }) {
  const { t } = useLocale();
  return (
    <FloatingGlassButton
      top={top}
      icon="chevron.left"
      accessibilityLabel={t("back")}
      onPress={onPress}
    />
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: SymbolViewProps["name"];
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <View style={{ alignItems: "center", gap: 10, paddingHorizontal: 32, paddingVertical: 52 }}>
      <View
        style={{
          alignItems: "center",
          backgroundColor: colors.surface,
          borderCurve: "continuous",
          borderRadius: 18,
          justifyContent: "center",
          minHeight: 64,
          minWidth: 64,
        }}
      >
        <SymbolView name={icon} tintColor={colors.secondaryLabel} size={30} accessible={false} />
      </View>
      <Text
        selectable
        style={{ color: colors.label, fontSize: 20, fontWeight: "700", textAlign: "center" }}
      >
        {title}
      </Text>
      <Text
        selectable
        style={{ color: colors.secondaryLabel, fontSize: 15, lineHeight: 21, textAlign: "center" }}
      >
        {description}
      </Text>
      {action}
    </View>
  );
}
