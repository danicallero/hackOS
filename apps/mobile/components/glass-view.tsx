import { GlassView as ExpoGlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import type { ComponentProps } from "react";
import { Platform, useColorScheme, View } from "react-native";
import { colors } from "@/theme/colors";

export type GlassViewProps = ComponentProps<typeof ExpoGlassView>;

/**
 * `expo-glass-effect` ships iOS-only native code — on Android its `GlassView`
 * falls back to a bare, background-less `View`, so every floating "glass"
 * control this app relies on (scanner chrome, floating back/action buttons,
 * inline banners) turns fully invisible there. The same blank fallback also
 * hits pre-Liquid-Glass iOS (iOS <26, e.g. iOS 18): `Platform.OS === "ios"`
 * is true there, but the native Liquid Glass API doesn't exist, so
 * `isLiquidGlassAvailable()` (real check on iOS, always `false` elsewhere)
 * is what actually gates the native view. Neither platform has an
 * equivalent to Liquid Glass's live blur, so both substitute an opaque
 * Material-style surface + elevation instead, keeping the same chrome
 * legible.
 */
export function GlassView({
  colorScheme = "auto",
  glassEffectStyle: _glassEffectStyle,
  isInteractive: _isInteractive,
  tintColor,
  style,
  ...viewProps
}: GlassViewProps) {
  const systemScheme = useColorScheme();
  if ((Platform.OS === "ios" || Platform.OS === "macos") && isLiquidGlassAvailable()) {
    return (
      <ExpoGlassView
        colorScheme={colorScheme}
        glassEffectStyle={_glassEffectStyle}
        isInteractive={_isInteractive}
        tintColor={tintColor}
        style={style}
        {...viewProps}
      />
    );
  }
  const scheme = colorScheme === "auto" ? (systemScheme ?? "light") : colorScheme;
  // `colors.surface` / `colors.elevatedSurface` resolve to Android's dynamic
  // Material You colors (`Color.android.dynamic.*`), which always track the
  // device's SYSTEM appearance and ignore this component's own `scheme`
  // decision entirely. That's fine when the caller left `colorScheme` at
  // "auto" — it should follow the system — but when a caller explicitly asks
  // for dark glass (e.g. floating chrome whose children assume white
  // text/icons), the dynamic color can still resolve light on a light-mode
  // device, leaving that white content invisible. Use fixed Material
  // surfaces on Android whenever the scheme was explicitly requested.
  const surface =
    Platform.OS === "android" && colorScheme !== "auto"
      ? scheme === "dark"
        ? "#2c2c2e"
        : "#ffffff"
      : scheme === "dark"
        ? colors.elevatedSurface
        : colors.surface;
  const background = tintColor ?? surface;
  return (
    <View
      {...viewProps}
      style={[
        {
          backgroundColor: background,
          boxShadow: colors.controlShadow,
          overflow: "hidden",
        },
        style,
      ]}
    />
  );
}
