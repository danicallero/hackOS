import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { PeopleDirectoryScreen } from "@/components/people-directory-screen";
import type { ScannerPerson } from "@/lib/scanner-types";
import { colors, motion } from "@/theme";
import { FINDER_HEADER_TOP } from "@/theme/layout-scan-pane";

/**
 * H22-H26, H55: the people finder as a self-contained pane that pushes in from the right edge over
 * ONE scanner pane (the Scanner's, or an activity's), like an iOS split-view push. It fills the
 * whole pane, including the band where the pane's own title sits (hosts hide that title while it
 * is open), and carries the standalone People screen's header: back button, large title that
 * collapses on scroll, role filter and search. The pane underneath stays mounted and untouched;
 * the finder mounts on first open and then stays, so closing it only slides it away.
 * `requireBadge` lists only badge holders, as an activity scan needs a badge.
 */
export function PeopleFinderPane({
  backLabel,
  onClose,
  onSelect,
  open,
  requireBadge = false,
}: {
  backLabel: string;
  onClose: () => void;
  onSelect: (person: ScannerPerson) => void;
  open: boolean;
  requireBadge?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(open);
  const progress = useSharedValue(open ? 1 : 0);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useEffect(() => {
    progress.set(
      reducedMotion
        ? withTiming(open ? 1 : 0, { duration: motion.duration.fast })
        : withSpring(open ? 1 : 0, { ...motion.springSoft, overshootClamping: true }),
    );
  }, [open, progress, reducedMotion]);

  const animatedStyle = useAnimatedStyle(() => {
    const value = progress.get();
    return reducedMotion
      ? { opacity: value }
      : { transform: [{ translateX: `${(1 - value) * 100}%` }] };
  }, [reducedMotion]);

  if (!mounted) return null;
  return (
    <Animated.View
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      pointerEvents={open ? "auto" : "none"}
      style={[
        {
          backgroundColor: colors.background,
          borderLeftColor: colors.separator,
          borderLeftWidth: StyleSheet.hairlineWidth,
          bottom: 0,
          left: 0,
          position: "absolute",
          right: 0,
          top: 0,
          zIndex: 40,
        },
        animatedStyle,
      ]}
    >
      <PeopleDirectoryScreen
        backLabel={backLabel}
        embedded
        headerTopInset={FINDER_HEADER_TOP}
        onClose={onClose}
        onSelect={onSelect}
        requireBadge={requireBadge}
      />
    </Animated.View>
  );
}
