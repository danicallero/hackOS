import { GlassView as ExpoGlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import type { ComponentProps } from "react";
import { type ColorSchemeName, Platform, useColorScheme, View } from "react-native";
import { colors } from "@/theme/colors";

export type GlassViewProps = ComponentProps<typeof ExpoGlassView>;

type GlassColorScheme = NonNullable<GlassViewProps["colorScheme"]>;

/** Resolve the fallback surface without letting Android dynamic colors ignore an explicit scheme. */
export function glassFallbackSurface(colorScheme: GlassColorScheme, systemScheme: ColorSchemeName) {
  if (colorScheme === "dark") return colors.glassDarkSurface;
  if (colorScheme === "light") return colors.glassLightSurface;
  return systemScheme === "dark" ? colors.elevatedSurface : colors.surface;
}

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
  const background = tintColor ?? glassFallbackSurface(colorScheme, systemScheme);
  return (
    <View
      {...viewProps}
      style={[
        {
          backgroundColor: background,
          boxShadow: colors.controlShadow,
        },
        style,
      ]}
    />
  );
}
