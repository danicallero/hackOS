import { Color } from "expo-router";
import { DynamicColorIOS, Platform } from "react-native";

function iosDynamic(light: string, dark: string) {
  return process.env.EXPO_OS === "ios" ? DynamicColorIOS({ light, dark }) : light;
}

/** Platform semantic colors: UIKit on iOS, Material You on Android, fixed fallbacks on web. */
export const colors = {
  transparent: "transparent",
  invisibleHitTarget: "rgba(0, 0, 0, 0.001)",
  controlShadow: "0 1px 2px rgba(0, 0, 0, 0.14)",
  qrBackground: "#ffffff",
  label: Platform.select({
    ios: Color.ios.label,
    android: Color.android.dynamic.onSurface,
    default: "#171717",
  })!,
  secondaryLabel: Platform.select({
    ios: Color.ios.secondaryLabel,
    android: Color.android.dynamic.onSurfaceVariant,
    default: "#5f6368",
  })!,
  tertiaryLabel: Platform.select({
    ios: Color.ios.tertiaryLabel,
    android: Color.android.dynamic.outline,
    default: "#7c7c80",
  })!,
  background: Platform.select({
    ios: Color.ios.systemGroupedBackground,
    android: Color.android.dynamic.surface,
    default: "#f5f5f7",
  })!,
  surface: Platform.select({
    ios: Color.ios.secondarySystemGroupedBackground,
    android: Color.android.dynamic.surfaceContainer,
    default: "#ffffff",
  })!,
  elevatedSurface: Platform.select({
    ios: Color.ios.tertiarySystemGroupedBackground,
    android: Color.android.dynamic.surfaceContainerHigh,
    default: "#ffffff",
  })!,
  separator: Platform.select({
    ios: Color.ios.separator,
    android: Color.android.dynamic.outlineVariant,
    default: "#d1d1d6",
  })!,
  accent: Platform.select({
    ios: Color.ios.systemBlue,
    android: Color.android.dynamic.primary,
    default: "#007aff",
  })!,
  accentText: Platform.select({
    ios: "#ffffff",
    android: Color.android.dynamic.onPrimary,
    default: "#ffffff",
  })!,
  accentSurface: Platform.select({
    ios: iosDynamic("#e8f2ff", "#102a43"),
    android: Color.android.dynamic.primaryContainer,
    default: "#e8f2ff",
  })!,
  success: Platform.select({
    ios: Color.ios.systemGreen,
    android: Color.android.dynamic.tertiary,
    default: "#248a3d",
  })!,
  successSurface: Platform.select({
    ios: iosDynamic("#e8f7ed", "#10351c"),
    android: Color.android.dynamic.tertiaryContainer,
    default: "#e8f7ed",
  })!,
  warning: Platform.select({
    ios: Color.ios.systemOrange,
    android: Color.android.dynamic.secondary,
    default: "#c25d00",
  })!,
  warningSurface: Platform.select({
    ios: iosDynamic("#fff3e0", "#3b260c"),
    android: Color.android.dynamic.secondaryContainer,
    default: "#fff3e0",
  })!,
  destructive: Platform.select({
    ios: Color.ios.systemRed,
    android: Color.android.dynamic.error,
    default: "#d70015",
  })!,
  destructiveSurface: Platform.select({
    ios: iosDynamic("#fff0f0", "#3a1114"),
    android: Color.android.dynamic.errorContainer,
    default: "#fff0f0",
  })!,
};
