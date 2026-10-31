import { Component, type ReactNode, useEffect, useRef } from "react";
import {
  AccessibilityInfo,
  Modal,
  Platform,
  Pressable,
  Text,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
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
import { UserAvatar } from "@/components/user-avatar";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";
import { type } from "@/theme/tokens";

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

/**
 * The Skia gooey merge, or null where Skia cannot load (web, a build without
 * the native module): the Reanimated version below then plays instead.
 */
const MergeCanvas: typeof import("./connection-celebration-skia").ConnectionMergeCanvas | null =
  (() => {
    if (Platform.OS === "web") return null;
    try {
      return require("./connection-celebration-skia").ConnectionMergeCanvas;
    } catch {
      return null;
    }
  })();

const AVATAR = 92;
const OVERLAP = AVATAR * 0.3;
const PARTICLES = 10;
/** Lets the overlay and the Skia canvas paint before the photos move. */
const FADE_IN_MS = 140;
const ENTER_DELAY_MS = 220;
const ENTER_MS = 850;
const MERGE_MS = ENTER_DELAY_MS + ENTER_MS;
const MOTION_MS = 3200;
const REDUCED_MS = 1600;

/**
 * #935: the moment two people connect. A full-screen overlay where both photos
 * fly in, fuse like metaballs with an elastic spring (Skia blur + alpha
 * threshold), and burst into a ring and particles (about 3.2 s).
 * Everything is a shared-value driven, so the frames run on the UI thread. If
 * Skia is unavailable or throws, the same beats play as Reanimated transforms
 * with a squash instead of the goo. Under reduced motion it is a short
 * crossfade with no travel, ring or particles and no canvas. Tapping anywhere
 * skips it.
 */
export function ConnectionCelebration({
  target,
  self,
  onDone,
  onCovered,
  inline = false,
}: {
  target: ConnectionCelebrationTarget | null;
  self: ConnectionCelebrationSelf;
  onDone: () => void;
  /**
   * Once the overlay hides the screen (or on an earlier skip): the caller
   * changes what is underneath, so it is already in place when this fades.
   */
  onCovered?: () => void;
  /**
   * Render as an overlay inside the caller (the QR scanner's own modal), so it
   * starts at once instead of waiting for that modal to dismiss.
   */
  inline?: boolean;
}) {
  if (inline) {
    return target ? (
      <View style={{ bottom: 0, left: 0, position: "absolute", right: 0, top: 0 }}>
        <Celebration
          key={target.key}
          target={target}
          self={self}
          onDone={onDone}
          onCovered={onCovered}
        />
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
        <Celebration
          key={target.key}
          target={target}
          self={self}
          onDone={onDone}
          onCovered={onCovered}
        />
      ) : null}
    </Modal>
  );
}

function Celebration({
  target,
  self,
  onDone,
  onCovered,
}: {
  target: ConnectionCelebrationTarget;
  self: ConnectionCelebrationSelf;
  onDone: () => void;
  onCovered?: () => void;
}) {
  const { t } = useLocale();
  const reduceMotion = useReducedMotion();
  const { width } = useWindowDimensions();
  const message = t("diaryConnected", { name: target.name });

  const fade = useSharedValue(0);
  const approach = useSharedValue(reduceMotion ? 1 : 0);
  const pop = useSharedValue(1);
  const burst = useSharedValue(0);

  const finished = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const onCoveredRef = useRef(onCovered);
  onCoveredRef.current = onCovered;
  const covered = useRef(false);
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: shared values are stable; the key remounts per celebration.
  useEffect(() => {
    const total = reduceMotion ? REDUCED_MS : MOTION_MS;
    fade.value = withSequence(
      withTiming(1, { duration: FADE_IN_MS }),
      withDelay(total - FADE_IN_MS - 320, withTiming(0, { duration: 320 })),
    );
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (reduceMotion) {
      void haptic("success");
    } else {
      // A timed slide that keeps accelerating, as if pulled together, so the
      // entry from both edges reads and the photos hit at full speed; the bounce is
      // saved for the merge (pop).
      approach.value = withDelay(
        ENTER_DELAY_MS,
        withTiming(1, { duration: ENTER_MS, easing: Easing.in(Easing.cubic) }),
      );
      pop.value = withDelay(
        MERGE_MS,
        withSequence(
          withTiming(1.18, { duration: 160, easing: Easing.out(Easing.quad) }),
          withSpring(1, { damping: 15, stiffness: 160 }),
        ),
      );
      burst.value = withDelay(
        MERGE_MS,
        withTiming(1, { duration: 1300, easing: Easing.out(Easing.cubic) }),
      );
      timers.push(setTimeout(() => void haptic("light"), ENTER_DELAY_MS));
      timers.push(setTimeout(() => void haptic("medium"), ENTER_DELAY_MS + ENTER_MS * 0.6));
      timers.push(setTimeout(() => void haptic("success"), MERGE_MS));
    }
    timers.push(setTimeout(cover, FADE_IN_MS + 60));
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
    opacity: burst.value > 0 ? (1 - burst.value) * 0.7 : 0,
    transform: [{ scale: 0.5 + burst.value * 2.4 }],
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
          {!reduceMotion && MergeCanvas ? (
            <MergeBoundary
              fallback={
                <SpringStage
                  reduceMotion={false}
                  self={self}
                  target={target}
                  stage={{ left, right, ring, burst }}
                />
              }
            >
              <MergeCanvas
                width={width}
                height={AVATAR * 3.4}
                avatar={AVATAR}
                travel={travel}
                apart={apart}
                approach={approach}
                pop={pop}
                burst={burst}
                self={{ name: self.name, image: self.image }}
                other={{ name: target.name, image: target.photoUrl }}
              />
            </MergeBoundary>
          ) : (
            <SpringStage
              reduceMotion={reduceMotion}
              self={self}
              target={target}
              stage={{ left, right, ring, burst }}
            />
          )}
        </View>
        <Text
          accessible={false}
          style={{
            color: colors.label,
            fontSize: type.body.fontSize,
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
    opacity: burst.value > 0 ? 1 - burst.value : 0,
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

/** Falls back to the Reanimated stage if the canvas throws while rendering. */
class MergeBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

type AnimatedStyle = ReturnType<typeof useAnimatedStyle<ViewStyle>>;

/** The photos, ring and particles as Reanimated transforms (no Skia). */
function SpringStage({
  reduceMotion,
  self,
  target,
  stage,
}: {
  reduceMotion: boolean;
  self: ConnectionCelebrationSelf;
  target: ConnectionCelebrationTarget;
  stage: {
    left: AnimatedStyle;
    right: AnimatedStyle;
    ring: AnimatedStyle;
    burst: SharedValue<number>;
  };
}) {
  return (
    <>
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
              stage.ring,
            ]}
          />
          {Array.from({ length: PARTICLES }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed ring of identical particles.
            <Particle key={index} index={index} burst={stage.burst} />
          ))}
        </>
      )}
      <Animated.View style={[{ position: "absolute" }, stage.left]}>
        <Ringed>
          <UserAvatar name={self.name} image={self.image} size={AVATAR} persist />
        </Ringed>
      </Animated.View>
      <Animated.View style={[{ position: "absolute" }, stage.right]}>
        <Ringed>
          <UserAvatar name={target.name} image={target.photoUrl} size={AVATAR} />
        </Ringed>
      </Animated.View>
    </>
  );
}
