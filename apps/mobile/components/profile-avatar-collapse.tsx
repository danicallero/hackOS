import MaskedView from "@react-native-masked-view/masked-view";
import { type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Image, Platform, useWindowDimensions, View } from "react-native";
import Animated, {
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
import {
  PROFILE_AVATAR_COLLAPSE_DISTANCE,
  type ProfileCameraCutoutFrame,
  profileAvatarCollapseBounds,
  profileAvatarContentFrame,
  profileAvatarCoverOpacity,
  profileAvatarMaskFrame,
  profileAvatarMorphPath,
  resolveProfileCameraTarget,
} from "@/lib/profile-avatar-collapse";
import CameraCapabilities from "@/modules/camera-capabilities";
import { colors } from "@/theme/colors";

type ProfileAvatarFrame = ProfileCameraCutoutFrame;
type AvatarVariant = "account" | "person";

export type ProfileAvatarCollapseController = ReturnType<typeof useProfileAvatarCollapse>;

/**
 * Scroll-driven profile-avatar morph based on Telegram's PeerInfoHeaderNode:
 * the scroll offset drives one mask/cover progress value, with an always-clipped
 * avatar, a cutout-sized black backing and a dark radial gradient on top.
 */
export function useProfileAvatarCollapse() {
  const scrollOffset = useSharedValue(0);
  const restingOffset = useSharedValue(0);
  const hasDragged = useSharedValue(false);
  const hostRef = useRef<View>(null);
  const anchorRef = useRef<View>(null);
  const [hostOrigin, setHostOrigin] = useState({ x: 0, y: 0 });
  const [anchorFrame, setAnchorFrame] = useState<ProfileAvatarFrame | null>(null);

  const onScroll = useAnimatedScrollHandler({
    onBeginDrag: () => {
      hasDragged.value = true;
    },
    onScroll: (event) => {
      // Capture automatic inset adjustments before the first gesture.
      // A later pull-to-refresh bounce must not redefine the resting offset.
      if (!hasDragged.value)
        restingOffset.value = Math.min(restingOffset.value, event.contentOffset.y);
      scrollOffset.value = Math.max(0, event.contentOffset.y - restingOffset.value);
    },
  });

  const measureAnchor = useCallback(() => {
    const host = hostRef.current;
    const anchor = anchorRef.current;
    if (!host || !anchor || !host.measureInWindow || !anchor.measureInWindow) return;

    host.measureInWindow((hostX, hostY) => {
      anchor.measureInWindow((x, y, width, height) => {
        setHostOrigin((previous) =>
          previous.x === hostX && previous.y === hostY ? previous : { x: hostX, y: hostY },
        );
        const next = { left: x - hostX, top: y - hostY + scrollOffset.value, width, height };
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
  }, [scrollOffset]);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
    },
    [],
  );
  // A screen pushed in a stack or presented as a modal is still sliding when
  // it first lays out, so a single measurement leaves the host origin (and the
  // island target derived from it) offset. Re-measure once the transition ends.
  const measureAfterLayout = useCallback(() => {
    requestAnimationFrame(() => requestAnimationFrame(measureAnchor));
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [450, 900].map((delay) => setTimeout(measureAnchor, delay));
  }, [measureAnchor]);

  return {
    anchorFrame,
    anchorRef,
    hostOrigin,
    hostRef,
    onAnchorLayout: measureAfterLayout,
    onHostLayout: measureAfterLayout,
    onScrollBeginDrag: measureAnchor,
    onContentSizeChange: measureAfterLayout,
    onScroll,
    scrollOffset,
  };
}

/** The original circle remains visible until scrolling transfers it to the mask. */
export function ProfileAvatarCollapseAnchor({
  controller,
  children,
  size,
}: {
  controller: ProfileAvatarCollapseController;
  children?: ReactNode;
  size: number;
}) {
  const { scrollOffset, anchorFrame } = controller;
  const style = useAnimatedStyle(
    () => ({
      opacity: anchorFrame && scrollOffset.value > 0 ? 0 : 1,
    }),
    [anchorFrame, scrollOffset],
  );
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

export function ProfileAvatarCollapse({
  controller,
  image,
  name,
  size,
  variant,
  cameraCutoutFrame,
  collapseDistance = PROFILE_AVATAR_COLLAPSE_DISTANCE,
  children,
}: {
  controller: ProfileAvatarCollapseController;
  image: string | null | undefined;
  name: string;
  size: number;
  variant: AvatarVariant;
  /** Window coordinates. Null selects a compact header circle instead. */
  cameraCutoutFrame?: ProfileCameraCutoutFrame | null;
  collapseDistance?: number;
  /** Optional live avatar content (video, rings or overlays), inside the same mask. */
  children?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  // Android only: real cutout rects (dp, window coords). Re-read on rotation/resize.
  // biome-ignore lint/correctness/useExhaustiveDependencies: window size changes when the cutout moves.
  const displayCutoutRects = useMemo(() => {
    if (Platform.OS !== "android") return null;
    try {
      return CameraCapabilities?.getDisplayCutoutRects?.() ?? null;
    } catch {
      return null;
    }
  }, [screenHeight, screenWidth]);
  const target = useMemo(
    () =>
      resolveProfileCameraTarget({
        cameraCutoutFrame,
        displayCutoutRects,
        height: screenHeight,
        platform: Platform.OS,
        safeAreaTop: insets.top,
        screenWidth,
      }),
    [cameraCutoutFrame, displayCutoutRects, insets.top, screenHeight, screenWidth],
  );
  const source = useApiImage(image);
  const gradientId = `profile-avatar-cover-${useId().replaceAll(":", "-")}`;
  const { anchorFrame, hostOrigin, scrollOffset } = controller;
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
  const maskProps = useAnimatedProps(() => {
    const progress = Math.max(0, Math.min(1, scrollOffset.value / distance));
    return {
      d: profileAvatarMorphPath(
        size,
        localStart,
        localTarget,
        progress,
        reduceMotion || !target.hasCutout,
      ),
    };
  }, [size, localStart, localTarget, distance, reduceMotion, target.hasCutout]);
  const overlayStyle = useAnimatedStyle(
    () => ({
      opacity: anchorFrame && scrollOffset.value > 0 ? 1 : 0,
    }),
    [anchorFrame, scrollOffset],
  );
  const contentStyle = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, scrollOffset.value / distance));
    return profileAvatarContentFrame(
      size,
      localStart,
      localTarget,
      p,
      reduceMotion || !target.hasCutout,
    );
  }, [size, localStart, localTarget, distance, reduceMotion, target.hasCutout]);
  const initialsStyle = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, scrollOffset.value / distance));
    const frame = profileAvatarMaskFrame(
      size,
      localStart,
      localTarget,
      p,
      reduceMotion || !target.hasCutout,
    );
    return {
      left: frame.left,
      top: frame.top,
      width: frame.width,
      height: frame.height,
      transform: [{ scale: 1 - p * 0.5 }],
    };
  }, [size, localStart, localTarget, distance, reduceMotion, target.hasCutout]);
  const coverStyle = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, scrollOffset.value / distance));
    return { opacity: target.hasCutout ? profileAvatarCoverOpacity(p, reduceMotion) : 0 };
  }, [distance, reduceMotion, target.hasCutout]);
  const gradientStyle = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, scrollOffset.value / distance));
    return { opacity: target.hasCutout && p > 0.03 ? 1 : 0 };
  }, [distance, target.hasCutout]);
  const blackStyle = useAnimatedStyle(() => {
    const p = Math.max(0, Math.min(1, scrollOffset.value / distance));
    return { opacity: target.hasCutout ? p : 0 };
  }, [distance, target.hasCutout]);
  if (!anchorFrame) return null;
  const fallbackColor = variant === "account" ? colors.accent : colors.accentSurface;
  const initialsColor = variant === "account" ? colors.accentText : colors.onAccentSurface;
  const initials = variant === "account" ? avatarInitials(name) : diaryInitials(name);
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
              <Image
                accessible={false}
                source={{ uri: source as string }}
                resizeMode="cover"
                style={{ height: "100%", width: "100%" }}
              />
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
