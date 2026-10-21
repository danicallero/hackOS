import { useEffect } from "react";
import { ActivityIndicator, type ActivityIndicatorProps, Platform, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { colors } from "@/theme";

const SPOKES = 12;
const SIZES = { small: 20, large: 37 } as const;

/**
 * The app's one spinner. iOS keeps UIActivityIndicatorView; Android draws the
 * same 12-spoke fading wheel instead of Material's circular arc (H55, H59).
 * Drop-in for react-native's ActivityIndicator (`color`, `size`, `animating`).
 */
export function AppActivityIndicator({
  animating = true,
  color,
  size = "small",
  style,
  ...rest
}: ActivityIndicatorProps) {
  if (Platform.OS !== "android") {
    return (
      <ActivityIndicator animating={animating} color={color} size={size} style={style} {...rest} />
    );
  }
  return (
    <SpokeWheel
      animating={animating}
      color={color ?? colors.secondaryLabel}
      dimension={typeof size === "number" ? size : SIZES[size]}
      style={style}
      testID={rest.testID}
    />
  );
}

function SpokeWheel({
  animating,
  color,
  dimension,
  style,
  testID,
}: {
  animating: boolean;
  color: ActivityIndicatorProps["color"];
  dimension: number;
  style: ActivityIndicatorProps["style"];
  testID?: string;
}) {
  const turn = useSharedValue(0);
  useEffect(() => {
    if (!animating) {
      cancelAnimation(turn);
      return;
    }
    // UIKit steps one spoke at a time, 12 steps per second.
    turn.value = 0;
    turn.value = withRepeat(withTiming(1, { duration: 1000, easing: Easing.steps(SPOKES) }), -1);
    return () => cancelAnimation(turn);
  }, [animating, turn]);
  const rotation = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.value * 360}deg` }],
  }));

  const spokeWidth = Math.max(2, dimension / 10);
  return (
    <View
      accessibilityRole="progressbar"
      style={[
        { alignItems: "center", height: dimension, justifyContent: "center", width: dimension },
        !animating ? { display: "none" } : null,
        style,
      ]}
      testID={testID}
    >
      <Animated.View style={[{ height: dimension, width: dimension }, rotation]}>
        {Array.from({ length: SPOKES }, (_, index) => (
          <View
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed geometry, never reordered
            key={index}
            style={{
              alignItems: "center",
              height: dimension,
              left: 0,
              opacity: 1 - (index / SPOKES) * 0.85,
              position: "absolute",
              top: 0,
              transform: [{ rotate: `${-index * 30}deg` }],
              width: dimension,
            }}
          >
            <View
              style={{
                backgroundColor: color,
                borderRadius: spokeWidth / 2,
                height: dimension * 0.28,
                width: spokeWidth,
              }}
            />
          </View>
        ))}
      </Animated.View>
    </View>
  );
}
