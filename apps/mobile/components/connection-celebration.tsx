import { type ReactNode, useEffect, useRef } from "react";
import { AccessibilityInfo, Modal, Pressable, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { SymbolView } from "@/components/symbol";
import { UserAvatar } from "@/components/user-avatar";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

/** Who was just met (#935): the scanned person's name and photo route. */
export interface ConnectionCelebrationTarget {
  /** Changes on every celebration, so a repeat plays again. */
  key: number;
  name: string;
  photoUrl: string | null;
}

/** The viewer, shown on the other side of the meeting. */
export interface ConnectionCelebrationSelf {
  name: string;
  image: string | null;
}

const AVATAR = 92;
const OVERLAP = AVATAR * 0.3;
const PARTICLES = 10;
const MERGE_MS = 420;
const MOTION_MS = 1600;
const REDUCED_MS = 1100;

/**
 * #935: the moment two people connect. A full-screen overlay where both photos
 * fly in, merge with an elastic spring, and burst into a ring, particles and a
 * link glyph (about 1.6 s). Everything is a shared-value transform, so the
 * frames run on the UI thread. Under reduced motion it is a short crossfade
 * with no travel, ring or particles. Tapping anywhere skips it.
 */
export function ConnectionCelebration({
  target,
  self,
  onDone,
}: {
  target: ConnectionCelebrationTarget | null;
  self: ConnectionCelebrationSelf;
  onDone: () => void;
}) {
  return (
    <Modal
      visible={target !== null}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onDone}
    >
      {target ? <Celebration key={target.key} target={target} self={self} onDone={onDone} /> : null}
    </Modal>
  );
}

function Celebration({
  target,
  self,
  onDone,
}: {
  target: ConnectionCelebrationTarget;
  self: ConnectionCelebrationSelf;
  onDone: () => void;
}) {
  const { t } = useLocale();
  const reduceMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  const message = t("diaryConnected", { name: target.name });

  const fade = useSharedValue(0);
  const approach = useSharedValue(reduceMotion ? 1 : 0);
  const pop = useSharedValue(1);
  const burst = useSharedValue(0);
  const glyph = useSharedValue(reduceMotion ? 1 : 0);

  const finished = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const finish = useRef(() => {
    if (finished.current) return;
    finished.current = true;
    onDoneRef.current();
  }).current;

  // biome-ignore lint/correctness/useExhaustiveDependencies: shared values are stable; the key remounts per celebration.
  useEffect(() => {
    const total = reduceMotion ? REDUCED_MS : MOTION_MS;
    fade.value = withSequence(
      withTiming(1, { duration: 180 }),
      withDelay(total - 180 - 260, withTiming(0, { duration: 260 })),
    );
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (reduceMotion) {
      void haptic("success");
    } else {
      approach.value = withSpring(1, { damping: 9, stiffness: 140, mass: 0.9 });
      pop.value = withDelay(
        MERGE_MS,
        withSequence(
          withTiming(1.16, { duration: 110, easing: Easing.out(Easing.quad) }),
          withSpring(1, { damping: 6, stiffness: 240 }),
        ),
      );
      glyph.value = withDelay(MERGE_MS, withSpring(1, { damping: 7, stiffness: 200 }));
      burst.value = withDelay(
        MERGE_MS,
        withTiming(1, { duration: 800, easing: Easing.out(Easing.cubic) }),
      );
      timers.push(setTimeout(() => void haptic("light"), 120));
      timers.push(setTimeout(() => void haptic("medium"), 300));
      timers.push(setTimeout(() => void haptic("success"), MERGE_MS));
    }
    timers.push(setTimeout(finish, total));
    void AccessibilityInfo.announceForAccessibility(message);
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  const travel = width / 2 + AVATAR;
  const apart = AVATAR / 2 - OVERLAP / 2;
  const scrim = useAnimatedStyle(() => ({ opacity: fade.value }));
  const left = useAnimatedStyle(() => ({
    transform: [{ translateX: -apart - (1 - approach.value) * travel }, { scale: pop.value }],
  }));
  const right = useAnimatedStyle(() => ({
    transform: [{ translateX: apart + (1 - approach.value) * travel }, { scale: pop.value }],
  }));
  const ring = useAnimatedStyle(() => ({
    opacity: (1 - burst.value) * 0.7,
    transform: [{ scale: 0.5 + burst.value * 2.4 }],
  }));
  const link = useAnimatedStyle(() => ({
    opacity: Math.min(glyph.value, 1),
    transform: [{ scale: glyph.value }],
  }));

  return (
    <Pressable
      testID="connection-celebration"
      accessibilityRole="button"
      accessibilityLabel={message}
      onPress={finish}
      style={{ flex: 1 }}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          {
            alignItems: "center",
            backgroundColor: colors.background,
            flex: 1,
            justifyContent: "center",
          },
          scrim,
        ]}
      >
        <View
          style={{
            alignItems: "center",
            height: AVATAR * 3.4,
            justifyContent: "center",
            width: "100%",
          }}
        >
          {reduceMotion ? null : (
            <>
              <Animated.View
                testID="connection-celebration-burst"
                style={[
                  {
                    borderColor: colors.accent,
                    borderRadius: AVATAR,
                    borderWidth: 3,
                    height: AVATAR,
                    position: "absolute",
                    width: AVATAR,
                  },
                  ring,
                ]}
              />
              {Array.from({ length: PARTICLES }, (_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a fixed ring of identical particles.
                <Particle key={index} index={index} burst={burst} />
              ))}
            </>
          )}
          <Animated.View style={[{ position: "absolute" }, left]}>
            <Ringed>
              <UserAvatar name={self.name} image={self.image} size={AVATAR} />
            </Ringed>
          </Animated.View>
          <Animated.View style={[{ position: "absolute" }, right]}>
            <Ringed>
              <UserAvatar name={target.name} image={target.photoUrl} size={AVATAR} />
            </Ringed>
          </Animated.View>
          <Animated.View
            style={[
              {
                alignItems: "center",
                backgroundColor: colors.accent,
                borderColor: colors.background,
                borderRadius: 20,
                borderWidth: 3,
                height: 40,
                justifyContent: "center",
                position: "absolute",
                width: 40,
              },
              link,
            ]}
          >
            <SymbolView name="link" size={20} tintColor={colors.accentText} />
          </Animated.View>
        </View>
        <Text
          accessible={false}
          style={{
            color: colors.label,
            fontSize: 17,
            fontWeight: "600",
            marginTop: 8,
            paddingHorizontal: 32,
            textAlign: "center",
          }}
        >
          {message}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

/** A background-colored rim, so overlapping photos stay distinct. */
function Ringed({ children }: { children: ReactNode }) {
  return (
    <View style={{ backgroundColor: colors.background, borderRadius: AVATAR, padding: 4 }}>
      {children}
    </View>
  );
}

function Particle({ index, burst }: { index: number; burst: SharedValue<number> }) {
  const angle = (index / PARTICLES) * Math.PI * 2;
  const reach = index % 2 === 0 ? 150 : 110;
  const size = index % 2 === 0 ? 10 : 7;
  const style = useAnimatedStyle(() => ({
    opacity: 1 - burst.value,
    transform: [
      { translateX: Math.cos(angle) * reach * burst.value },
      { translateY: Math.sin(angle) * reach * burst.value },
      { scale: 1 - burst.value * 0.7 },
    ],
  }));
  return (
    <Animated.View
      style={[
        {
          backgroundColor: colors.accent,
          borderRadius: size / 2,
          height: size,
          position: "absolute",
          width: size,
        },
        style,
      ]}
    />
  );
}
