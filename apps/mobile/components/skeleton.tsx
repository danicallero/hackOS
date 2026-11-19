import { type ReactNode, useEffect } from "react";
import { type DimensionValue, View } from "react-native";
import Animated, {
  cancelAnimation,
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useLocale } from "@/lib/i18n";
import { colors, motion, radius, space, type } from "@/theme";

/** One shimmer cycle: slow enough to read as waiting, not as an alert. */
const SHIMMER_MS = 900;

/**
 * Placeholders for content still on its way (H55, #935): grey shapes in the
 * page's own sections that breathe gently, then the real sections fade in.
 * Static under Reduce Motion. One announcement for the whole group.
 */
export function SkeletonGroup({ children, testID }: { children: ReactNode; testID?: string }) {
  const { t } = useLocale();
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (reduceMotion) {
      opacity.value = 1;
      return;
    }
    opacity.value = withRepeat(withTiming(0.55, { duration: SHIMMER_MS }), -1, true);
    return () => cancelAnimation(opacity);
  }, [opacity, reduceMotion]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      testID={testID}
      accessible
      accessibilityLabel={t("loading")}
      accessibilityRole="progressbar"
      accessibilityLiveRegion="polite"
      style={[{ gap: space.xxl }, style]}
    >
      {children}
    </Animated.View>
  );
}

/** A grey bar the height of a line of text. */
export function SkeletonBar({
  width,
  height = type.callout.fontSize,
}: {
  width: DimensionValue;
  height?: number;
}) {
  return (
    <View
      style={{
        backgroundColor: colors.hover,
        borderCurve: "continuous",
        borderRadius: radius.full,
        height,
        width,
      }}
    />
  );
}

/** Ragged line widths read as text, not as a progress bar. */
const ROW_WIDTHS = ["86%", "58%", "72%", "44%"] as const;

/** A grouped section (`Section`'s shape) with up to four placeholder lines. */
export function SkeletonSection({ rows = 2, title = false }: { rows?: number; title?: boolean }) {
  return (
    <View style={{ gap: space.sm }}>
      {title ? (
        <View style={{ paddingHorizontal: space.lg }}>
          <SkeletonBar width="28%" height={type.footnote.fontSize} />
        </View>
      ) : null}
      <View
        style={{
          backgroundColor: colors.surface,
          borderCurve: "continuous",
          borderRadius: radius.container,
          gap: space.md,
          paddingHorizontal: space.lg,
          paddingVertical: space.lg,
        }}
      >
        {ROW_WIDTHS.slice(0, rows).map((width) => (
          <SkeletonBar key={width} width={width} />
        ))}
      </View>
    </View>
  );
}

/** The header of a profile still without a list to seed it: avatar, name and subtitle. */
export function SkeletonProfileHeader({
  size,
  shape = "circle",
}: {
  size: number;
  shape?: "circle" | "tile";
}) {
  return (
    <View style={{ alignItems: "center", gap: space.md }}>
      <View
        style={{
          backgroundColor: colors.hover,
          borderCurve: "continuous",
          borderRadius: shape === "circle" ? size / 2 : radius.sheet,
          height: size,
          width: size,
        }}
      />
      <SkeletonBar width="46%" height={type.title.fontSize} />
      <SkeletonBar width="32%" />
    </View>
  );
}

/** Wraps content that replaces a skeleton, so it fades in instead of popping. */
export function RevealView({ children }: { children: ReactNode }) {
  return (
    <Animated.View entering={FadeIn.duration(motion.duration.base)} style={{ gap: space.xxl }}>
      {children}
    </Animated.View>
  );
}
