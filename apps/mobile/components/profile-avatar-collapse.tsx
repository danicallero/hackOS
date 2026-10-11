import MaskedView from "@react-native-masked-view/masked-view";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Image,
  type LayoutChangeEvent,
  Platform,
  type ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  runOnJS,
  useAnimatedProps,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import { useApiImage } from "@/components/person-avatar";
import { avatarInitials } from "@/components/user-avatar";
import { diaryInitials } from "@/lib/diary";
import { haptic } from "@/lib/haptics";
import {
  PROFILE_AVATAR_COLLAPSE_DISTANCE,
  PROFILE_AVATAR_MERGE_PROGRESS,
  PROFILE_AVATAR_SIMPLE_MIN_SCALE,
  PROFILE_AVATAR_SNAP_REST_VELOCITY,
  PROFILE_GOOEY_MARGIN,
  type ProfileCameraCutoutFrame,
  profileAvatarCollapseBounds,
  profileAvatarContentFrame,
  profileAvatarCoverOpacity,
  profileAvatarMaskFrame,
  profileAvatarMinContentHeight,
  profileAvatarMorphPath,
  profileAvatarRestingOffsetBound,
  profileAvatarSimpleTransform,
  profileAvatarSnapDirection,
  profileAvatarSnapOffset,
  profileGooeyFrame,
  profileGooeyProgress,
  resolveProfileCameraTarget,
} from "@/lib/profile-avatar-collapse";
import CameraCapabilities from "@/modules/camera-capabilities";
import { ProfileGooeyView } from "@/modules/profile-gooey";
import { colors } from "@/theme/colors";

type ProfileAvatarFrame = ProfileCameraCutoutFrame;
type AvatarVariant = "account" | "person";

export type ProfileAvatarCollapseController = ReturnType<typeof useProfileAvatarCollapse>;

/**
 * Scroll-driven profile-avatar morph based on Telegram's PeerInfoHeaderNode:
 * the scroll offset drives one mask/cover progress value, with an always-clipped
 * avatar, a cutout-sized black backing and a dark radial gradient on top.
 *
 * A released drag never leaves the morph half-way (#935): it settles at fully
 * expanded or fully collapsed. Pass the screen's own scroll ref when it has
 * one; otherwise spread the returned `scrollRef` onto the scroll view.
 * A screen under a shown native header passes its `headerHeight`, which the
 * automatic inset adds to the true top. Spread `contentMinHeight` onto the
 * content container so a short page still reaches the collapsed rest.
 *
 * Without a camera cutout to morph into, or under Reduce Motion, the avatar
 * instead stays in the content (`simple`): no overlay, snap or haptics. Pass
 * `onNameLayout` to the view right below the anchor, in the same parent, so
 * the avatar leaves with the content before that view reaches it.
 */
export function useProfileAvatarCollapse(
  screenScrollRef?: RefObject<ScrollView | null>,
  {
    headerHeight = 0,
    cameraCutoutFrame,
  }: {
    headerHeight?: number;
    /** Window coordinates of an OEM camera cutout, overriding detection. */
    cameraCutoutFrame?: ProfileCameraCutoutFrame | null;
  } = {},
) {
  const scrollOffset = useSharedValue(0);
  const contentOffset = useSharedValue(0);
  const restingOffset = useSharedValue(0);
  const hasDragged = useSharedValue(false);
  // Only a user drag arms the snap, so programmatic scrolls are left alone.
  const snapArmed = useSharedValue(false);
  // Last non-zero scroll delta: the direction of the drag or momentum (#935).
  const lastDelta = useSharedValue(0);
  // Set at the collapsed rest; the next pull out of it taps once (#935).
  const stretchArmed = useSharedValue(false);
  // Content height minus the viewport: an offset the page surely reaches.
  const maxOffset = useSharedValue(Number.POSITIVE_INFINITY);
  const contentHeight = useRef(0);
  const viewportHeight = useRef(0);
  const [viewport, setViewport] = useState(0);
  const ownScrollRef = useRef<ScrollView>(null);
  const scrollRef = screenScrollRef ?? ownScrollRef;
  const reduceMotion = useReducedMotion();
  const safeAreaTop = useSafeAreaInsets().top;
  const target = useProfileCameraTarget(cameraCutoutFrame, safeAreaTop);
  const simple = reduceMotion || !target.hasCutout;
  // Layout gap between the anchor's bottom and the view below it (`simple`).
  const anchorBottom = useRef<number | null>(null);
  const nameTop = useRef<number | null>(null);
  const [simpleGap, setSimpleGap] = useState(0);
  const updateSimpleGap = useCallback(() => {
    if (anchorBottom.current === null || nameTop.current === null) return;
    setSimpleGap(Math.max(0, nameTop.current - anchorBottom.current));
  }, []);
  const hostRef = useRef<View>(null);
  const anchorRef = useRef<View>(null);
  const [hostOrigin, setHostOrigin] = useState({ x: 0, y: 0 });
  const [anchorFrame, setAnchorFrame] = useState<ProfileAvatarFrame | null>(null);

  const scrollToOffset = useCallback(
    (y: number) => scrollRef.current?.scrollTo({ animated: !reduceMotion, y }),
    [reduceMotion, scrollRef],
  );

  // One tap as the photo starts merging into the camera cutout, and one as
  // a collapsed avatar starts stretching back out of it (#935).
  const mergeHaptic = useCallback(() => void haptic("medium"), []);

  // Plain locals so the scroll worklets capture them explicitly.
  const collapseDistance = PROFILE_AVATAR_COLLAPSE_DISTANCE;
  const restVelocity = PROFILE_AVATAR_SNAP_REST_VELOCITY;
  const mergeOffset = PROFILE_AVATAR_COLLAPSE_DISTANCE * PROFILE_AVATAR_MERGE_PROGRESS;
  // Tolerance around the collapsed rest before a pull counts (points).
  const stretchSlop = 2;
  const platform = Platform.OS;

  const settle = (offset: number, velocity: number) => {
    "worklet";
    snapArmed.value = false;
    // The plain collapse has no half-morphed state to leave.
    if (simple) return;
    const direction = profileAvatarSnapDirection(lastDelta.value, velocity, platform);
    const target = profileAvatarSnapOffset(
      offset,
      restingOffset.value,
      direction,
      collapseDistance,
      maxOffset.value,
    );
    if (target === null) return;
    runOnJS(scrollToOffset)(target);
  };

  const onScroll = useAnimatedScrollHandler(
    {
      onBeginDrag: (event) => {
        // The first drag usually starts at the top, even when the inset's
        // own scroll event arrived before this handler was attached.
        if (!hasDragged.value)
          restingOffset.value = Math.min(restingOffset.value, event.contentOffset.y);
        hasDragged.value = true;
        snapArmed.value = true;
        lastDelta.value = 0;
      },
      onScroll: (event) => {
        // Capture automatic inset adjustments before the first gesture.
        // A later pull-to-refresh bounce must not redefine the resting offset.
        if (!hasDragged.value)
          restingOffset.value = Math.min(restingOffset.value, event.contentOffset.y);
        const delta = event.contentOffset.y - contentOffset.value;
        if (delta !== 0) lastDelta.value = delta;
        contentOffset.value = event.contentOffset.y;
        const previous = scrollOffset.value;
        scrollOffset.value = Math.max(0, event.contentOffset.y - restingOffset.value);
        // The plain collapse never meets a camera cutout.
        if (simple) return;
        // Tap once each time the photo reaches the island on the way up, and
        // as soon as a collapsed avatar starts stretching out on the way down.
        const current = scrollOffset.value;
        if (previous < mergeOffset && current >= mergeOffset) runOnJS(mergeHaptic)();
        // A snap can settle a fraction of a point short of the collapsed rest,
        // so arm near it and fire once the pull clearly leaves it.
        if (current >= collapseDistance - stretchSlop) stretchArmed.value = true;
        else if (stretchArmed.value && current < collapseDistance - 2 * stretchSlop) {
          stretchArmed.value = false;
          runOnJS(mergeHaptic)();
        }
      },
      onEndDrag: (event) => {
        const velocity = event.velocity?.y ?? 0;
        // A moving release decelerates first; its momentum end decides.
        if (Math.abs(velocity) >= restVelocity) return;
        settle(event.contentOffset.y, velocity);
      },
      onMomentumEnd: (event) => {
        // Momentum follows its own direction, which the last delta tracks.
        if (snapArmed.value) settle(event.contentOffset.y, 0);
      },
    },
    [scrollToOffset, mergeHaptic, simple],
  );

  const measureFrame = useRef<number | null>(null);
  // Fabric measures the committed shadow tree, whose scroll state trails the
  // live offset. Mixing a measurement taken during a scroll (the gear's jump
  // to the top and scroll to preferences, a fling) with the offset read when
  // it lands bakes the scrolled distance into the anchor, drawing the mask
  // away from the hidden avatar (#935). Measure only once the offset has held
  // still for a frame, and retry if it moved before the result arrived.
  const measureAnchor = useCallback(
    function measure() {
      if (measureFrame.current !== null) cancelAnimationFrame(measureFrame.current);
      const offset = scrollOffset.value;
      measureFrame.current = requestAnimationFrame(() => {
        measureFrame.current = null;
        const host = hostRef.current;
        const anchor = anchorRef.current;
        if (!host || !anchor || !host.measureInWindow || !anchor.measureInWindow) return;
        if (scrollOffset.value !== offset) {
          measure();
          return;
        }
        host.measureInWindow((hostX, hostY) => {
          anchor.measureInWindow((x, y, width, height) => {
            if (scrollOffset.value !== offset) {
              measure();
              return;
            }
            setHostOrigin((previous) =>
              previous.x === hostX && previous.y === hostY ? previous : { x: hostX, y: hostY },
            );
            const next = { left: x - hostX, top: y - hostY + offset, width, height };
            setAnchorFrame((previous) =>
              previous &&
              previous.left === next.left &&
              previous.top === next.top &&
              previous.width === next.width &&
              previous.height === next.height
                ? previous
                : next,
            );
          });
        });
      });
    },
    [scrollOffset],
  );

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
      if (measureFrame.current !== null) cancelAnimationFrame(measureFrame.current);
    },
    [],
  );
  // A screen pushed in a stack or presented as a modal is still sliding when
  // it first lays out, so a single measurement leaves the host origin (and the
  // island target derived from it) offset. Re-measure once the transition ends.
  const measureAfterLayout = useCallback(() => {
    requestAnimationFrame(measureAnchor);
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [450, 900].map((delay) => setTimeout(measureAnchor, delay));
  }, [measureAnchor]);

  // iOS: seed the true top from the status-bar (or native header) overlap
  // once the host is measured, so it holds even when no scroll event preceded
  // a programmatic scroll or a remount restored the offset at y 0 (#935).
  useEffect(() => {
    if (Platform.OS !== "ios" || !anchorFrame) return;
    const bound = profileAvatarRestingOffsetBound(safeAreaTop, hostOrigin.y, headerHeight);
    if (bound >= restingOffset.value) return;
    restingOffset.value = bound;
    scrollOffset.value = Math.max(0, contentOffset.value - bound);
  }, [
    anchorFrame,
    contentOffset,
    headerHeight,
    hostOrigin.y,
    restingOffset,
    safeAreaTop,
    scrollOffset,
  ]);

  // The snap compares the collapsed rest with `contentHeight - viewport`, so
  // the floor uses the status-bar bound alone: a header only lowers the rest.
  const contentMinHeight =
    viewport > 0 && !simple
      ? profileAvatarMinContentHeight(
          viewport,
          Platform.OS === "ios" ? profileAvatarRestingOffsetBound(safeAreaTop, hostOrigin.y) : 0,
          PROFILE_AVATAR_COLLAPSE_DISTANCE,
        )
      : undefined;

  /** Scroll to the true top, for tab re-press (`useScrollToTop`). */
  const scrollToTopRef = useMemo(
    () => ({ current: { scrollToTop: () => scrollToOffset(restingOffset.value) } }),
    [restingOffset, scrollToOffset],
  );

  const updateMaxOffset = () => {
    if (contentHeight.current > 0 && viewportHeight.current > 0)
      maxOffset.value = contentHeight.current - viewportHeight.current;
  };

  /** Move a scroll left inside the morph by a non-drag (remount, focus) to the nearer rest. */
  const settleAtRest = useCallback(() => {
    if (simple) return;
    requestAnimationFrame(() => {
      const target = profileAvatarSnapOffset(
        contentOffset.value,
        restingOffset.value,
        0,
        PROFILE_AVATAR_COLLAPSE_DISTANCE,
        maxOffset.value,
      );
      if (target !== null) scrollRef.current?.scrollTo({ animated: false, y: target });
    });
  }, [contentOffset, maxOffset, restingOffset, scrollRef, simple]);

  return {
    anchorFrame,
    anchorRef,
    hostOrigin,
    contentMinHeight,
    hostRef,
    onAnchorLayout: (event?: LayoutChangeEvent) => {
      const layout = event?.nativeEvent?.layout;
      if (layout) {
        anchorBottom.current = layout.y + layout.height;
        updateSimpleGap();
      }
      measureAfterLayout();
    },
    onNameLayout: ({ nativeEvent }: LayoutChangeEvent) => {
      nameTop.current = nativeEvent.layout.y;
      updateSimpleGap();
    },
    onHostLayout: ({ nativeEvent }: LayoutChangeEvent) => {
      viewportHeight.current = nativeEvent.layout.height;
      setViewport(nativeEvent.layout.height);
      updateMaxOffset();
      measureAfterLayout();
    },
    onScrollBeginDrag: measureAnchor,
    onContentSizeChange: (_width: number, height: number) => {
      contentHeight.current = height;
      updateMaxOffset();
      measureAfterLayout();
    },
    onScroll,
    /** Content offset of the true top (negative under an automatic inset). */
    restingOffset,
    scrollOffset,
    scrollRef,
    scrollToTopRef,
    settleAtRest,
    simple,
    simpleGap,
    target,
  };
}

/**
 * The camera-area morph target in window coordinates. Android reads the real
 * cutout rects, re-read when the window size changes (rotation, resize).
 */
function useProfileCameraTarget(
  cameraCutoutFrame: ProfileCameraCutoutFrame | null | undefined,
  safeAreaTop: number,
) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  // biome-ignore lint/correctness/useExhaustiveDependencies: window size changes when the cutout moves.
  const displayCutoutRects = useMemo(() => {
    if (Platform.OS !== "android") return null;
    try {
      return CameraCapabilities?.getDisplayCutoutRects?.() ?? null;
    } catch {
      return null;
    }
  }, [screenHeight, screenWidth]);
  return useMemo(
    () =>
      resolveProfileCameraTarget({
        cameraCutoutFrame,
        displayCutoutRects,
        height: screenHeight,
        platform: Platform.OS,
        safeAreaTop,
        screenWidth,
      }),
    [cameraCutoutFrame, displayCutoutRects, safeAreaTop, screenHeight, screenWidth],
  );
}

/**
 * The original circle remains visible until scrolling transfers it to the
 * mask. In the plain collapse it stays the only avatar: it holds still and
 * shrinks until the view below reaches it, then scrolls away with the page.
 */
export function ProfileAvatarCollapseAnchor({
  controller,
  children,
  size,
}: {
  controller: ProfileAvatarCollapseController;
  children?: ReactNode;
  size: number;
}) {
  const { scrollOffset, anchorFrame, simple, simpleGap } = controller;
  const reduceMotion = useReducedMotion();
  const minScale = PROFILE_AVATAR_SIMPLE_MIN_SCALE;
  const style = useAnimatedStyle(() => {
    if (!simple)
      return {
        opacity: anchorFrame && scrollOffset.value > 0 ? 0 : 1,
        transform: [{ translateY: 0 }, { scale: 1 }],
      };
    const { translateY, scale } = profileAvatarSimpleTransform(
      scrollOffset.value,
      size,
      simpleGap,
      minScale,
      reduceMotion,
    );
    return { opacity: 1, transform: [{ translateY }, { scale }] };
  }, [anchorFrame, scrollOffset, simple, simpleGap, size, reduceMotion]);
  return (
    <Animated.View
      ref={controller.anchorRef}
      collapsable={false}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      onLayout={controller.onAnchorLayout}
      pointerEvents="none"
      style={[{ height: size, width: size }, style]}
    >
      {children}
    </Animated.View>
  );
}

const AnimatedPath = Animated.createAnimatedComponent(Path);
// Android hole-punch morph, driven from the UI thread through animated props.
const AnimatedProfileGooeyView = ProfileGooeyView
  ? Animated.createAnimatedComponent(ProfileGooeyView)
  : null;

export function ProfileAvatarCollapse({
  controller,
  image,
  name,
  size,
  variant,
  collapseDistance = PROFILE_AVATAR_COLLAPSE_DISTANCE,
  children,
}: {
  controller: ProfileAvatarCollapseController;
  image: string | null | undefined;
  name: string;
  size: number;
  variant: AvatarVariant;
  collapseDistance?: number;
  /** Optional live avatar content (video, rings or overlays), inside the same mask. */
  children?: ReactNode;
}) {
  const source = useApiImage(image);
  const gradientId = `profile-avatar-cover-${useId().replaceAll(":", "-")}`;
  // Only a camera cutout gets the overlay; the plain collapse (`simple`)
  // keeps the anchor in the scroll content (#935).
  const { anchorFrame, hostOrigin, scrollOffset, simple, target } = controller;
  const start = anchorFrame ?? { left: 0, top: 0, width: size, height: size };
  const destination = {
    left: target.left - hostOrigin.x,
    top: target.top - hostOrigin.y,
    width: target.width,
    height: target.height,
  };
  const bounds = profileAvatarCollapseBounds(start, destination);
  const localStart = { ...start, left: start.left - bounds.left, top: start.top - bounds.top };
  const localTarget = {
    ...destination,
    left: destination.left - bounds.left,
    top: destination.top - bounds.top,
  };
  const distance = Math.max(1, collapseDistance);
  // Android with a hole punch: the native gooey view replaces the Dynamic
  // Island mask, whose keyframes stretch a small round lens target into a
  // needle. iOS and Android without the native module keep the mask below.
  const gooey = AnimatedProfileGooeyView !== null && Platform.OS === "android" && !simple;
  const gooeyBox = {
    left: bounds.left - PROFILE_GOOEY_MARGIN,
    top: bounds.top - PROFILE_GOOEY_MARGIN,
    width: bounds.width + 2 * PROFILE_GOOEY_MARGIN,
    height: bounds.height + 2 * PROFILE_GOOEY_MARGIN,
  };
  const gooeyStart = { ...start, left: start.left - gooeyBox.left, top: start.top - gooeyBox.top };
  const gooeyHole = {
    ...destination,
    left: destination.left - gooeyBox.left,
    top: destination.top - gooeyBox.top,
  };
  const gooeyProps = useAnimatedProps(
    () =>
      profileGooeyFrame(
        gooeyStart,
        gooeyHole,
        profileGooeyProgress(scrollOffset.value, distance),
        distance,
      ),
    [gooeyStart, gooeyHole, distance],
  );
  const maskProps = useAnimatedProps(() => {
    const progress = Math.max(0, Math.min(1, scrollOffset.value / distance));
    return {
      d: profileAvatarMorphPath(size, localStart, localTarget, progress),
    };
  }, [size, localStart, localTarget, distance]);
  const overlayStyle = useAnimatedStyle(
    () => ({
      opacity: anchorFrame && scrollOffset.value > 0 ? 1 : 0,
    }),
    [anchorFrame, scrollOffset],
  );
  const contentStyle = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, scrollOffset.value / distance));
    return profileAvatarContentFrame(size, localStart, localTarget, p);
  }, [size, localStart, localTarget, distance]);
  const initialsStyle = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, scrollOffset.value / distance));
    const frame = profileAvatarMaskFrame(size, localStart, localTarget, p);
    // Centred where the photo would be, on the clip's blob (#935).
    const content = profileAvatarContentFrame(size, localStart, localTarget, p);
    return {
      left: content.left + content.width / 2 - frame.width / 2,
      top:
        content.top +
        content.height -
        Math.min(content.width, content.height) / 2 -
        frame.height / 2,
      width: frame.width,
      height: frame.height,
      transform: [{ scale: 1 - p * 0.5 }],
    };
  }, [size, localStart, localTarget, distance]);
  const coverStyle = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, scrollOffset.value / distance));
    return { opacity: profileAvatarCoverOpacity(p) };
  }, [distance]);
  const gradientStyle = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, scrollOffset.value / distance));
    return { opacity: p > 0.03 ? 1 : 0 };
  }, [distance]);
  const blackStyle = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, scrollOffset.value / distance));
    return { opacity: p };
  }, [distance]);
  // Telegram-style progressive blur: blurred copies of the photo fade in as
  // the avatar heads into the camera cutout (#935). Two radii keep the ramp
  // smooth without animating a native blur on every frame.
  const softBlurStyle = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, scrollOffset.value / distance));
    return { opacity: Math.min(1, Math.max(0, (p - 0.05) / 0.4)) };
  }, [distance]);
  const strongBlurStyle = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, scrollOffset.value / distance));
    return { opacity: Math.min(1, Math.max(0, (p - 0.35) / 0.45)) };
  }, [distance]);
  if (!anchorFrame || simple) return null;
  const fallbackColor = variant === "account" ? colors.accent : colors.accentSurface;
  const initialsColor = variant === "account" ? colors.accentText : colors.onAccentSurface;
  const initials = variant === "account" ? avatarInitials(name) : diaryInitials(name);
  if (gooey && AnimatedProfileGooeyView) {
    return (
      <Animated.View
        testID="profile-avatar-collapse-mask"
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[{ position: "absolute", ...gooeyBox, zIndex: 21 }, overlayStyle]}
      >
        <AnimatedProfileGooeyView
          testID="profile-avatar-gooey"
          animatedProps={gooeyProps}
          holeX={gooeyHole.left + gooeyHole.width / 2}
          holeY={gooeyHole.top + gooeyHole.height / 2}
          holeDiameter={Math.min(gooeyHole.width, gooeyHole.height)}
          style={absoluteFill}
        >
          {/* Laid out once at the expanded frame; the native view scales it. */}
          <View
            collapsable={false}
            style={{
              position: "absolute",
              left: gooeyStart.left,
              top: gooeyStart.top,
              width: size,
              height: size,
              borderRadius: size / 2,
              overflow: "hidden",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: source || children ? colors.elevatedSurface : fallbackColor,
            }}
          >
            {children ??
              (source ? (
                <Image
                  accessible={false}
                  source={{ uri: source }}
                  resizeMode="cover"
                  style={{ height: size, width: size, borderRadius: size / 2 }}
                />
              ) : (
                <Text
                  accessible={false}
                  style={{ color: initialsColor, fontSize: size * 0.36, fontWeight: "700" }}
                >
                  {initials}
                </Text>
              ))}
          </View>
        </AnimatedProfileGooeyView>
      </Animated.View>
    );
  }
  return (
    <Animated.View
      testID="profile-avatar-collapse-mask"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[{ position: "absolute", ...bounds, zIndex: 21 }, overlayStyle]}
    >
      <MaskedView
        style={{ flex: 1 }}
        androidRenderingMode="software"
        maskElement={
          <Svg
            width={bounds.width}
            height={bounds.height}
            viewBox={`0 0 ${bounds.width} ${bounds.height}`}
          >
            <AnimatedPath fill="#fff" animatedProps={maskProps} />
          </Svg>
        }
      >
        <View
          style={[
            absoluteFill,
            { backgroundColor: source || children ? colors.elevatedSurface : fallbackColor },
          ]}
        />
        {children || source ? (
          <Animated.View style={[{ position: "absolute" }, contentStyle]}>
            {children ?? (
              <>
                <Image
                  accessible={false}
                  source={{ uri: source as string }}
                  resizeMode="cover"
                  style={{ height: "100%", width: "100%" }}
                />
                <Animated.Image
                  accessible={false}
                  blurRadius={6}
                  source={{ uri: source as string }}
                  resizeMode="cover"
                  style={[absoluteFill, softBlurStyle]}
                />
                <Animated.Image
                  accessible={false}
                  blurRadius={18}
                  source={{ uri: source as string }}
                  resizeMode="cover"
                  style={[absoluteFill, strongBlurStyle]}
                />
              </>
            )}
          </Animated.View>
        ) : (
          <Animated.View
            style={[
              { position: "absolute", alignItems: "center", justifyContent: "center" },
              initialsStyle,
            ]}
          >
            <Animated.Text
              accessible={false}
              style={{ color: initialsColor, fontSize: size * 0.36, fontWeight: "700" }}
            >
              {initials}
            </Animated.Text>
          </Animated.View>
        )}
        <Animated.View style={[absoluteFill, { backgroundColor: "#000" }, blackStyle]} />
        <Animated.View style={[absoluteFill, { backgroundColor: "#000" }, coverStyle]} />
        <Animated.View
          style={[
            {
              position: "absolute",
              left: localTarget.left + localTarget.width / 2 - 50,
              top: localTarget.top + localTarget.height - 2,
              width: 100,
              height: 100,
            },
            gradientStyle,
          ]}
        >
          <Svg height="100" width="100" viewBox="0 0 100 100">
            <Defs>
              <RadialGradient id={gradientId} cx="50" cy="88" r="90" gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor="#000" stopOpacity="0" />
                <Stop offset="0.87" stopColor="#000" stopOpacity="0" />
                <Stop offset="1" stopColor="#000" stopOpacity="1" />
              </RadialGradient>
            </Defs>
            <Rect fill={`url(#${gradientId})`} height="100" width="100" />
          </Svg>
        </Animated.View>
      </MaskedView>
    </Animated.View>
  );
}

const absoluteFill = { bottom: 0, left: 0, position: "absolute" as const, right: 0, top: 0 };
