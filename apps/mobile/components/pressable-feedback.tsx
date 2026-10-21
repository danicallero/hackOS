import { type ReactNode, useState } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { type HapticIntent, haptic } from "@/lib/haptics";
import {
  colors,
  motion,
  pointer as pointerTokens,
  pressed as pressedTokens,
  radius,
} from "@/theme";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * How a control answers a touch. One vocabulary on iOS and Android — Android
 * deliberately gets no Material ripple.
 * - `row`: the cell turns the grouped-list highlight colour (UIKit table cells).
 * - `opacity`: text and icon buttons fade.
 * - `scale`: filled buttons and cards shrink slightly and spring back.
 * - `none`: the control draws its own feedback (glass, native controls).
 */
export type PressFeedback = "row" | "opacity" | "scale" | "none";

type PointerHandlers = Pick<PressableProps, "onHoverIn" | "onHoverOut" | "onFocus" | "onBlur">;

/**
 * Pointer hover and keyboard-focus state for a custom control (iPad trackpad,
 * Mac, Android mouse, hardware keyboard). Hover never fires for touch; both are
 * ignored when `disabled`. Spread `handlers` on a Pressable; call `clearFocus`
 * from its press-in so a click or tap does not leave the keyboard ring behind.
 * `focusRingStyle(radius)` is the outline to merge into the control's style.
 */
export function usePointerState({ disabled }: { disabled?: boolean | null } = {}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const handlers: PointerHandlers = {
    onHoverIn: () => setHovered(true),
    onHoverOut: () => setHovered(false),
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
  };
  return {
    hovered: !disabled && hovered,
    focusVisible: !disabled && focused,
    handlers,
    clearFocus: () => setFocused(false),
  };
}

export function focusRingStyle(focusRadius: number = radius.control): ViewStyle {
  return {
    borderRadius: focusRadius,
    borderCurve: "continuous",
    outlineColor: colors.accent,
    outlineWidth: pointerTokens.focusRingWidth,
    outlineOffset: pointerTokens.focusRingOffset,
    outlineStyle: "solid",
  };
}

export type PressableFeedbackProps = Omit<PressableProps, "style" | "children"> & {
  feedback?: PressFeedback;
  /** Haptic fired on press; omit for none. */
  haptic?: HapticIntent;
  /** Corner radius of the keyboard focus ring; match the control. */
  focusRadius?: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

export function PressableFeedback({
  feedback = "opacity",
  haptic: hapticIntent,
  focusRadius = radius.control,
  focusable = true,
  disabled,
  style,
  onPress,
  onPressIn,
  onPressOut,
  onHoverIn,
  onHoverOut,
  onFocus,
  onBlur,
  children,
  ...rest
}: PressableFeedbackProps) {
  const reduceMotion = useReducedMotion();
  const progress = useSharedValue(0);
  const hover = useSharedValue(0);
  const pointerState = usePointerState({ disabled });
  const ring = pointerState.focusVisible ? focusRingStyle(focusRadius) : null;
  const pointerHandlers: PointerHandlers = {
    onHoverIn: (event) => {
      pointerState.handlers.onHoverIn?.(event);
      if (!disabled) hover.value = withTiming(1, { duration: motion.duration.fast });
      onHoverIn?.(event);
    },
    onHoverOut: (event) => {
      pointerState.handlers.onHoverOut?.(event);
      hover.value = withTiming(0, { duration: motion.duration.fast });
      onHoverOut?.(event);
    },
    onFocus: (event) => {
      pointerState.handlers.onFocus?.(event);
      onFocus?.(event);
    },
    onBlur: (event) => {
      pointerState.handlers.onBlur?.(event);
      onBlur?.(event);
    },
  };

  const animated = useAnimatedStyle(() => {
    if (feedback === "opacity") {
      return {
        opacity:
          (1 - hover.value * (1 - pointerTokens.hoverOpacity)) *
          (1 - progress.value * (1 - pressedTokens.opacity)),
      };
    }
    if (feedback === "scale") {
      return {
        opacity:
          (1 - hover.value * (1 - pointerTokens.hoverFilledOpacity)) *
          (1 - progress.value * (1 - pressedTokens.filledOpacity)),
        transform: [{ scale: 1 - progress.value * (1 - pressedTokens.scale) }],
      };
    }
    return {};
  });

  const animate = (to: 0 | 1) => {
    progress.value = reduceMotion
      ? withTiming(to, { duration: motion.duration.fast })
      : withSpring(to, motion.spring);
  };

  const accessibilityState = { disabled: !!disabled, ...rest.accessibilityState };

  if (feedback === "row" || feedback === "none") {
    return (
      <Pressable
        {...rest}
        {...pointerHandlers}
        focusable={focusable}
        accessibilityState={accessibilityState}
        disabled={disabled}
        onPress={(event) => {
          if (hapticIntent) void haptic(hapticIntent);
          onPress?.(event);
        }}
        onPressIn={(event) => {
          pointerState.clearFocus();
          onPressIn?.(event);
        }}
        onPressOut={onPressOut}
        style={({ pressed }) => [
          ring,
          disabled ? { opacity: pressedTokens.disabledOpacity } : null,
          style,
          // Highlight wins over a caller background so surface rows still react.
          feedback === "row" && pointerState.hovered && !pressed
            ? { backgroundColor: colors.hover }
            : null,
          feedback === "row" && pressed ? { backgroundColor: colors.elevatedSurface } : null,
        ]}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <AnimatedPressable
      {...rest}
      {...pointerHandlers}
      focusable={focusable}
      accessibilityState={accessibilityState}
      disabled={disabled}
      onPress={(event) => {
        if (hapticIntent) void haptic(hapticIntent);
        onPress?.(event);
      }}
      onPressIn={(event) => {
        pointerState.clearFocus();
        animate(1);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animate(0);
        onPressOut?.(event);
      }}
      style={[style, ring, disabled ? { opacity: pressedTokens.disabledOpacity } : animated]}
    >
      {children}
    </AnimatedPressable>
  );
}
