import { GlassView as ExpoGlassView } from "expo-glass-effect";
import type { ComponentProps } from "react";
import { Platform, useColorScheme, View } from "react-native";

export type GlassViewProps = ComponentProps<typeof ExpoGlassView>;

/**
 * `expo-glass-effect` ships iOS-only native code — on Android its `GlassView`
 * falls back to a bare, background-less `View`, so every floating "glass"
 * control this app relies on (scanner chrome, floating back/action buttons,
 * inline banners) turns fully invisible there. Android has no equivalent to
 * Liquid Glass's live blur, so this substitutes an opaque Material-style
 * surface + elevation instead, keeping the same chrome legible.
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
  if (Platform.OS === "ios" || Platform.OS === "macos") {
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
  const background =
    tintColor ?? (scheme === "dark" ? "rgba(30, 30, 32, 0.85)" : "rgba(255, 255, 255, 0.85)");
  return (
    <View
      {...viewProps}
      style={[
        {
          backgroundColor: background,
          elevation: 6,
          overflow: "hidden",
          shadowColor: "#000",
          shadowOffset: { height: 2, width: 0 },
          shadowOpacity: 0.2,
          shadowRadius: 6,
        },
        style,
      ]}
    />
  );
}
