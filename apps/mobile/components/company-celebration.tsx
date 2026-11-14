import { useEffect, useRef } from "react";
import { AccessibilityInfo, Modal, Pressable, Text, View } from "react-native";
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Logo } from "@/components/company-profile-screen";
import { useColorScheme } from "@/components/useColorScheme";
import type { DiarySponsor } from "@/lib/diary";
import { haptic } from "@/lib/haptics";
import { NO_PHOTO_TINT } from "@/lib/hero-tint";
import { useLocale } from "@/lib/i18n";
import { useImageTint } from "@/lib/image-tint";
import { colors, radius, type } from "@/theme";

/** The stand just collected (#935). `key` changes per scan so a repeat plays again. */
export interface CompanyCelebrationTarget {
  key: number;
  sponsor: Pick<DiarySponsor, "enterpriseId" | "name" | "logoUrl" | "logoNegativeUrl">;
}

const LOGO = 188;
const PULSES = 3;
const PULSE_MS = 1500;
const ENTER_MS = 650;
const TOTAL_MS = 3000;
const REDUCED_MS = 1400;

/**
 * #935: the moment a stand is collected. The logo springs in over a wash of its
 * own colour that pulses outward like a heartbeat, with a rising haptic beat
 * (about 3 s). Tapping skips it; `onCovered` fires once the overlay hides the
 * screen so the company page is already open underneath when it fades.
 */
export function CompanyCelebration({
  target,
  onDone,
  onCovered,
  inline = false,
}: {
  target: CompanyCelebrationTarget | null;
  onDone: () => void;
  onCovered?: () => void;
  /** Render inside the caller (the QR scanner's own modal) instead of a Modal. */
  inline?: boolean;
}) {
  if (inline) {
    return target ? (
      <View style={{ bottom: 0, left: 0, position: "absolute", right: 0, top: 0 }}>
        <Celebration key={target.key} target={target} onDone={onDone} onCovered={onCovered} />
      </View>
    ) : null;
  }
  return (
    <Modal
      visible={target !== null}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onDone}
    >
      {target ? (
        <Celebration key={target.key} target={target} onDone={onDone} onCovered={onCovered} />
      ) : null}
    </Modal>
  );
}

function rgb(color: string | null): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(color ?? "");
  if (!match) return NO_PHOTO_TINT;
  const n = Number.parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function Celebration({
  target,
  onDone,
  onCovered,
}: {
  target: CompanyCelebrationTarget;
  onDone: () => void;
  onCovered?: () => void;
}) {
  const { t } = useLocale();
  const dark = useColorScheme() === "dark";
  const reduceMotion = useReducedMotion();
  const { sponsor } = target;
  const tint = useImageTint(sponsor.logoUrl);
  const [r, g, b] = rgb(tint.color);
  const message = `${sponsor.name}. ${t("companyCollected")}`;

  const fade = useSharedValue(0);
  const wash = useSharedValue(0);
  const logo = useSharedValue(reduceMotion ? 1 : 0);
  const label = useSharedValue(reduceMotion ? 1 : 0);
  const pulse = useSharedValue(0);
  const finished = useRef(false);
  const covered = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const onCoveredRef = useRef(onCovered);
  onCoveredRef.current = onCovered;
  const cover = useRef(() => {
    if (covered.current) return;
    covered.current = true;
    onCoveredRef.current?.();
  }).current;
  const finish = useRef(() => {
    if (finished.current) return;
    finished.current = true;
    cover();
    onDoneRef.current();
  }).current;

  // The wash fades in once the logo colour is known, and not at all if it never is.
  // biome-ignore lint/correctness/useExhaustiveDependencies: shared values are stable.
  useEffect(() => {
    wash.value = withTiming(1, { duration: 500 });
  }, [tint.settled]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: shared values are stable; the key remounts per celebration.
  useEffect(() => {
    const total = reduceMotion ? REDUCED_MS : TOTAL_MS;
    fade.value = withSequence(
      withTiming(1, { duration: 160 }),
      withDelay(total - 160 - 320, withTiming(0, { duration: 320 })),
    );
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (reduceMotion) {
      void haptic("success");
    } else {
      logo.value = withDelay(180, withSpring(1, { damping: 11, stiffness: 140, mass: 0.9 }));
      label.value = withDelay(180 + ENTER_MS, withTiming(1, { duration: 450 }));
      pulse.value = withDelay(
        180 + ENTER_MS * 0.5,
        withRepeat(withTiming(1, { duration: PULSE_MS, easing: Easing.out(Easing.quad) }), -1),
      );
      // A rising beat: tap, thump as the logo lands, success, then a soft
      // tick with each pulse that leaves.
      timers.push(setTimeout(() => void haptic("light"), 180));
      timers.push(setTimeout(() => void haptic("medium"), 180 + ENTER_MS * 0.55));
      timers.push(setTimeout(() => void haptic("success"), 180 + ENTER_MS));
      for (let i = 1; i <= PULSES - 1; i += 1) {
        timers.push(setTimeout(() => void haptic("light"), 180 + ENTER_MS + i * (PULSE_MS * 0.6)));
      }
    }
    timers.push(setTimeout(cover, 220));
    timers.push(setTimeout(finish, total));
    void AccessibilityInfo.announceForAccessibility(message);
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  const scrim = useAnimatedStyle(() => ({ opacity: fade.value }));
  const washStyle = useAnimatedStyle(() => ({
    opacity: wash.value * (0.75 + 0.25 * (1 - pulse.value)),
  }));
  const logoStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, logo.value * 2),
    transform: [{ scale: 0.35 + logo.value * 0.65 }],
  }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: label.value,
    transform: [{ translateY: (1 - label.value) * 14 }],
  }));

  return (
    <Pressable
      testID="company-celebration"
      accessibilityRole="button"
      accessibilityLabel={message}
      onPress={finish}
      style={{ flex: 1 }}
    >
      <Animated.View
        pointerEvents="none"
        style={[{ backgroundColor: colors.background, flex: 1 }, scrim]}
      >
        <Animated.View
          style={[
            {
              bottom: 0,
              experimental_backgroundImage: `linear-gradient(to bottom, rgba(${r},${g},${b},${dark ? 0.5 : 0.62}) 0%, rgba(${r},${g},${b},0) 70%)`,
              left: 0,
              position: "absolute",
              right: 0,
              top: 0,
            },
            washStyle,
          ]}
        />
        <View style={{ alignItems: "center", flex: 1, gap: 28, justifyContent: "center" }}>
          <View
            style={{ alignItems: "center", height: LOGO, justifyContent: "center", width: LOGO }}
          >
            {reduceMotion
              ? null
              : [0, 1, 2].map((index) => (
                  <PulseRing key={index} index={index} pulse={pulse} rgb={[r, g, b]} dark={dark} />
                ))}
            <Animated.View style={logoStyle}>
              <Logo profile={sponsor} dark={dark} muted={false} size={LOGO} />
            </Animated.View>
          </View>
          <Animated.View
            style={[{ alignItems: "center", gap: 6, paddingHorizontal: 32 }, labelStyle]}
          >
            <Text
              style={{
                color: colors.label,
                fontSize: type.title2.fontSize,
                fontWeight: "700",
                textAlign: "center",
              }}
            >
              {sponsor.name}
            </Text>
            <Text style={{ color: colors.secondaryLabel, fontSize: type.subhead.fontSize }}>
              {t("companyCollected")}
            </Text>
          </Animated.View>
        </View>
      </Animated.View>
    </Pressable>
  );
}

/** One expanding ring of the logo's colour; the three are staggered a third of a beat apart. */
function PulseRing({
  index,
  pulse,
  rgb: [r, g, b],
  dark,
}: {
  index: number;
  pulse: SharedValue<number>;
  rgb: [number, number, number];
  dark: boolean;
}) {
  const style = useAnimatedStyle(() => {
    const phase = (pulse.value + index / 3) % 1;
    return {
      opacity: (1 - phase) * (pulse.value > 0 ? 1 : 0),
      transform: [{ scale: 1 + phase * 1.9 }],
    };
  });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          backgroundColor: `rgba(${r},${g},${b},${dark ? 0.35 : 0.3})`,
          borderColor: `rgba(${r},${g},${b},0.7)`,
          borderCurve: "continuous",
          borderRadius: radius.sheet,
          borderWidth: 2,
          height: LOGO,
          position: "absolute",
          width: LOGO,
        },
        style,
      ]}
    />
  );
}
