import { useEffect } from "react";
import { Pressable, type SwitchProps } from "react-native";
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { haptic } from "@/lib/haptics";
import { colors, motion, pressed } from "@/theme";

const WIDTH = 51;
const HEIGHT = 31;
const THUMB = 27;
const INSET = 2;

/**
 * UIKit's UISwitch drawn for Android (H55, H59): 51 x 31 capsule, white thumb
 * with a soft shadow, green track when on. Material's Switch is the leak this
 * replaces; iOS keeps the native control (`AppSwitch` in native-ui). Colours
 * are read per render so a scheme change recolours the track.
 */
export function IosSwitch({
  value = false,
  onValueChange,
  disabled = false,
  style,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: SwitchProps) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    progress.value = reduceMotion
      ? withTiming(value ? 1 : 0, { duration: motion.duration.fast })
      : withSpring(value ? 1 : 0, motion.spring);
  }, [value, reduceMotion, progress]);

  const off = String(colors.separator);
  const on = String(colors.success);
  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [off, on]),
  }));
  const thumb = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.value * (WIDTH - THUMB - INSET * 2) }],
  }));

  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={() => {
        void haptic("selection");
        onValueChange?.(!value);
      }}
      style={[{ opacity: disabled ? pressed.disabledOpacity : 1 }, style]}
      testID={testID}
    >
      <Animated.View
        style={[
          { borderRadius: HEIGHT / 2, height: HEIGHT, justifyContent: "center", width: WIDTH },
          track,
        ]}
      >
        <Animated.View
          style={[
            {
              backgroundColor: colors.glassLightSurface,
              borderRadius: THUMB / 2,
              boxShadow: "0 2px 4px rgba(0, 0, 0, 0.25)",
              height: THUMB,
              marginLeft: INSET,
              width: THUMB,
            },
            thumb,
          ]}
        />
      </Animated.View>
    </Pressable>
  );
}
