import { GlassView as ExpoGlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { type Href, usePathname } from "expo-router";
import {
  TabList,
  TabSlot,
  Tabs,
  TabTrigger,
  type TabTriggerSlotProps,
  useTabTrigger,
} from "expo-router/ui";
import {
  type ComponentType,
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type ColorValue,
  type GestureResponderEvent,
  Platform,
  Pressable,
  type StyleProp,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useDockBackGesture } from "@/components/app-back-gesture";
import {
  ROUTER_TAB_BAR_VERTICAL_CELL,
  ROUTER_TAB_BAR_VERTICAL_WIDTH,
  RouterTabBarInsetsProvider,
  ROUTER_TAB_BAR_HEIGHT as TAB_BAR_HEIGHT,
  useRouterTabBarInsets,
} from "@/lib/router-tabs-inset";
import { useSideRegion } from "@/lib/side-region";
import { CHROME_MAX_FONT_SIZE_MULTIPLIER, CHROME_MIN_FONT_SCALE } from "@/theme/dynamic-type";
import { type } from "@/theme/tokens";

export type { RouterTabBarInsets } from "@/lib/router-tabs-inset";
export {
  useRouterTabBarBottomInset,
  useRouterTabBarInsets,
  useRouterTabBarScrollBottomInset,
} from "@/lib/router-tabs-inset";

export const MAX_DIRECT_TABS = 4;
export const MAX_TABS_WITHOUT_OVERFLOW = MAX_DIRECT_TABS + 1;
export const ROUTER_TAB_BAR_HEIGHT = TAB_BAR_HEIGHT;
const ROUTER_TAB_BAR_HORIZONTAL_PADDING = 16;
const TAB_SELECTION_SPRING = { damping: 20, mass: 0.8, stiffness: 220 };
/** A tap's lens travel: lifted at the current tab, it glides and lands on the target. */
/**
 * The lens's travel to a pressed tab. One spring from touch-down to release:
 * retargeting a spring keeps its velocity, so a tap never stops mid-flight.
 * Near-critical, and finished once visually still so landing starts at once.
 */
const TAB_TRAVEL_SPRING = {
  damping: 27,
  mass: 0.9,
  stiffness: 210,
  restDisplacementThreshold: 0.5,
  restSpeedThreshold: 12,
};
/** Stiff enough to stay under a dragging finger. */
const TAB_TRACKING_SPRING = { damping: 28, mass: 0.6, stiffness: 520 };
/** How far the pressed lens grows past the bar's top and bottom edges. */
const PRESS_LENS_OUTSET = 3;
/**
 * The lifted lens spans this many cells, like the system bar's: wide enough
 * that the clear glass bends only at its rim and the centre stays flat.
 */
const PRESS_LENS_CELLS = 1.6;
/** Near-critical, and settled once visually still, so landing never lingers. */
const PRESS_LENS_SPRING = {
  damping: 26,
  mass: 0.7,
  stiffness: 320,
  restDisplacementThreshold: 0.002,
  restSpeedThreshold: 0.02,
};
/** Far below the window: where the idle clear lens waits, still laid out. */
const LENS_PARKED_Y = 10000;
/** The whole bar grows slightly while a finger is down. */
const PRESS_BAR_GROWTH = 0.04;
/** Horizontal travel that turns a press into a scrub. */
const TAB_SCRUB_SLOP = 8;

export type RouterTabsSurfaceMode = "liquid-glass" | "opaque";
export type RouterTabsColorScheme = "auto" | "light" | "dark";

/** Props a custom tab-surface renderer must accept. */
export interface RouterTabsSurfaceProps {
  children?: ReactNode;
  /** Appearance used by native Liquid Glass; opaque fallbacks may ignore it. */
  colorScheme: RouterTabsColorScheme;
  /** Whether the native material should use its interactive treatment. */
  isInteractive: boolean;
  /** The shell's resolved material mode for the current platform. */
  mode: RouterTabsSurfaceMode;
  /** System reduced-motion preference for custom material animations. */
  reducedMotion: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Injectable material adapter for consumers that do not use Expo Glass. */
export type RouterTabsSurfaceComponent = ComponentType<RouterTabsSurfaceProps>;

/**
 * Checks the Expo runtime capability rather than an iOS version, so current
 * and future iOS releases (including iOS 27+) use their native material.
 */
export function isRouterTabsLiquidGlassAvailable(): boolean {
  return (Platform.OS === "ios" || Platform.OS === "macos") && isLiquidGlassAvailable();
}

/** A direct cell in the visual tab bar. The caller owns icon rendering. */
export interface RouterTabItem {
  /** Expo Router destination for this direct tab. */
  href: Href;
  /** Inactive icon node; keep its layout size stable across states. */
  icon: ReactNode;
  /** One-line visible label and the control's accessibility label. */
  label: string;
  /** Unique `TabTrigger` name shared with the complete route registry. */
  name: string;
  /** Optional active icon node; `icon` is reused when omitted. */
  selectedIcon?: ReactNode;
  /**
   * Optional active-state override for tabs whose route subtree is shared
   * with other destinations. Receives the current pathname; the default is a
   * prefix match on `href`.
   */
  isActive?: (pathname: string) => boolean;
  /** Optional stable selector for native UI tests. */
  testID?: string;
}

/** A route registered with Expo Router, including hidden overflow routes. */
export interface RouterTabRoute {
  href: Href;
  name: string;
}

/** Semantic colours used by Liquid Glass and its opaque fallback. */
export interface RouterTabsTheme {
  /** Inactive label token. */
  label: ColorValue;
  /** Active label token. */
  selectedLabel: ColorValue;
  /** Opaque active-lens fill used without real Liquid Glass. */
  selectedSurface: ColorValue;
  /** Optional React Native box shadow for the bar and active lens. */
  shadow?: string;
  /** Opaque bar fill used without real Liquid Glass. */
  surface: ColorValue;
  /** Transparent token used by the overlay and hit targets. */
  transparent: ColorValue;
}

/** Props for the reusable Expo Router tab shell. */
export interface RouterTabsProps {
  /** Direct destinations in visual and scrub order. */
  tabs: RouterTabItem[];
  /** Full route registry, including destinations hidden behind `overflow`. */
  routes?: RouterTabRoute[];
  /** Ready-to-render overflow control; it is placed in its own circle. */
  overflow?: ReactNode;
  /** Side effects for ordinary direct-tab presses, such as haptics. */
  onTabPress?: (tab: RouterTabItem, wasSelected: boolean) => void;
  /** Side effects after a direct tab release, including a scrub selection. */
  onTabSelect?: (index: number) => void;
  /** Direct-cell budget when `overflow` is present; defaults to four. */
  maxDirectTabs?: number;
  /** Direct-cell budget without `overflow`; defaults to five. */
  maxTabsWithoutOverflow?: number;
  /** Theme overrides for opaque fallbacks on intentionally themed screens. */
  fallbackTheme?: Partial<RouterTabsTheme>;
  /** Appearance used by native Liquid Glass surfaces and opaque fallbacks. */
  colorScheme?: RouterTabsColorScheme;
  /** Optional material adapter; Expo Glass is used when omitted. */
  surfaceComponent?: RouterTabsSurfaceComponent;
  /** Prefix for the shell's native test identifiers. */
  testID?: string;
  /** Semantic colours for both rendering paths. */
  theme: RouterTabsTheme;
}

/**
 * Reusable Expo Router tab shell. It owns routing, safe-area containment and
 * the four-tab + separated-overflow geometry (or five direct tabs when the
 * overflow slot is unused); callers own labels, icons and the native menu
 * implementation. iOS 26+ uses Liquid Glass surfaces while older iOS and
 * Android use the same geometry with an opaque surface.
 */
export function RouterTabs({
  onTabPress,
  onTabSelect,
  overflow,
  routes,
  tabs,
  fallbackTheme,
  maxDirectTabs = MAX_DIRECT_TABS,
  maxTabsWithoutOverflow = MAX_TABS_WITHOUT_OVERFLOW,
  colorScheme = "auto",
  surfaceComponent = DefaultRouterTabsSurface,
  testID = "router-tabs",
  theme,
}: RouterTabsProps) {
  const liquidGlass = isRouterTabsLiquidGlassAvailable();
  const resolvedTheme = liquidGlass ? theme : { ...theme, ...fallbackTheme };
  const directTabLimit = overflow ? maxDirectTabs : maxTabsWithoutOverflow;
  const directTabs = tabs.slice(0, directTabLimit);
  const registeredRoutes = routes ?? tabs.map(({ href, name }) => ({ href, name }));
  const sideRegion = useSideRegion();
  const tabletSidebar =
    sideRegion.tabletRail === true || (Platform.OS === "android" && sideRegion.edge !== null);
  const slotPadding = tabletSidebar
    ? sideRegion.edge === "right"
      ? { paddingRight: sideRegion.size }
      : { paddingLeft: sideRegion.size }
    : {};

  if (__DEV__ && tabs.length > directTabLimit) {
    console.warn(
      `[router-tabs] Received ${tabs.length} direct tabs; only ${directTabLimit} are rendered. ` +
        "Move the remaining destinations to the overflow menu.",
    );
  }

  return (
    <RouterTabBarInsetsProvider>
      <Tabs style={{ flex: 1 }} testID={testID}>
        <View style={{ flex: 1, ...slotPadding }}>
          <TabSlot style={{ flex: 1 }} />
        </View>
        <RouterTabsContent
          colorScheme={colorScheme}
          directTabs={directTabs}
          liquidGlass={liquidGlass}
          onTabPress={onTabPress}
          onTabSelect={onTabSelect}
          overflow={overflow}
          surfaceComponent={surfaceComponent}
          testID={testID}
          theme={resolvedTheme}
        />
        <TabList style={{ display: "none" }}>
          {registeredRoutes.map(({ href, name }) => (
            <TabTrigger key={name} href={href} name={name} />
          ))}
        </TabList>
      </Tabs>
    </RouterTabBarInsetsProvider>
  );
}

interface RouterTabsContentProps {
  colorScheme: RouterTabsColorScheme;
  directTabs: RouterTabItem[];
  liquidGlass: boolean;
  onTabPress?: (tab: RouterTabItem, wasSelected: boolean) => void;
  onTabSelect?: (index: number) => void;
  overflow?: ReactNode;
  surfaceComponent: RouterTabsSurfaceComponent;
  testID: string;
  theme: RouterTabsTheme;
}

function RouterTabsContent({
  colorScheme,
  directTabs,
  liquidGlass,
  onTabPress,
  onTabSelect,
  overflow,
  surfaceComponent,
  testID,
  theme,
}: RouterTabsContentProps) {
  const pathname = usePathname();
  const sideRegion = useSideRegion();
  const {
    tabBarBottomPadding: bottomPadding,
    tabBarHeight,
    tabBarVerticalPadding,
  } = useRouterTabBarInsets();
  const directTabCount = directTabs.length;
  const directTabNames = useMemo(() => directTabs.map(({ name }) => name), [directTabs]);
  const { switchTab } = useTabTrigger({ name: directTabNames[0] ?? "" });
  const reducedMotion = useReducedMotion();
  const selectedDirectTabIndex = directTabs.findIndex((tab) => isTabActive(pathname, tab));
  const [directGroupWidth, setDirectGroupWidth] = useState(0);
  const selectionOffset = useSharedValue(0);
  // H55: 0 resting, 1 lifted. Driven only from the gesture worklet, so the
  // lift, travel and landing stay on the UI thread with no React render.
  const lift = useSharedValue(0);
  // 1 while the clear lens is on screen; it is parked off-screen otherwise.
  const lensShown = useSharedValue(0);
  const directTabCellWidth = directTabCount > 0 ? directGroupWidth / directTabCount : 0;
  const tabItemHeight = tabBarHeight - tabBarVerticalPadding;
  const tabItemVerticalInset = (tabBarHeight - tabItemHeight) / 2;

  useEffect(() => {
    // A lifted lens is still travelling under the gesture; it lands itself.
    if (lift.value > 0) return;
    if (selectedDirectTabIndex < 0 || directTabCellWidth <= 0) {
      cancelAnimation(selectionOffset);
      selectionOffset.value = 0;
      return;
    }

    const nextOffset = selectedDirectTabIndex * directTabCellWidth;
    selectionOffset.value = reducedMotion
      ? nextOffset
      : withSpring(nextOffset, TAB_SELECTION_SPRING);
  }, [directTabCellWidth, lift, reducedMotion, selectedDirectTabIndex, selectionOffset]);

  const commitTabSelection = useCallback(
    (nextIndex: number) => {
      const nextName = directTabNames[nextIndex];
      if (nextName === undefined) return;

      onTabSelect?.(nextIndex);

      // A scrub ends on a destination rather than pressing it, so it only
      // needs the router's tab state transition; reselecting the current tab
      // by dragging back to it is a no-op, not a scroll-to-top press.
      if (nextIndex === selectedDirectTabIndex) return;
      switchTab(nextName, {});
    },
    [directTabNames, onTabSelect, selectedDirectTabIndex, switchTab],
  );

  // H55: the bar's gesture owns every touch, so a tap must run the same press
  // as the cell's TabTrigger (tabPress event, reselect actions, haptics).
  // Each cell registers that press here; VoiceOver and keyboard activation
  // still reach the Pressable directly.
  const tabPresses = useRef<Array<(() => void) | undefined>>([]);
  const pressTab = useCallback((index: number) => tabPresses.current[index]?.(), []);

  const dockBackGesture = useDockBackGesture();
  const touchStartX = useSharedValue(0);
  const touchX = useSharedValue(0);
  const scrubbed = useSharedValue(false);
  const tabScrubGesture = useMemo(() => {
    const restingOffset =
      selectedDirectTabIndex >= 0 ? selectedDirectTabIndex * directTabCellWidth : 0;
    const followFinger = (x: number, tracking: boolean) => {
      "worklet";
      const target = selectionOffsetForPosition(x, directGroupWidth, directTabCount);
      selectionOffset.value = reducedMotion
        ? target
        : tracking
          ? withSpring(target, TAB_TRACKING_SPRING)
          : withSpring(target, TAB_TRAVEL_SPRING);
    };
    // H55: like the system tab bar, the lens moves under the finger on touch
    // down anywhere in the group and follows it in both directions; release
    // selects the cell underneath. Activating on touch down makes this the
    // only owner of the touch: the cells' Pressables are cancelled (so a long
    // press cannot switch tabs mid-drag) and the dock back swipe, which waits
    // on this gesture, cannot claim a rightward drag.
    return Gesture.Manual()
      .blocksExternalGesture(...(dockBackGesture ? [dockBackGesture] : []))
      .enabled(directTabCount > 0 && directTabCellWidth > 0)
      .onTouchesDown((event, manager) => {
        "worklet";
        const touch = event.allTouches[0];
        if (!touch || event.numberOfTouches > 1) return;
        touchStartX.value = touch.x;
        touchX.value = touch.x;
        scrubbed.value = false;
        manager.activate();
        cancelAnimation(selectionOffset);
        // Lift where the lens rests, then glide towards the finger.
        followFinger(touch.x, false);
        lift.value = reducedMotion ? 1 : withSpring(1, PRESS_LENS_SPRING);
        lensShown.value = 1;
      })
      .onTouchesMove((event) => {
        "worklet";
        const touch = event.allTouches[0];
        if (!touch) return;
        touchX.value = touch.x;
        if (!scrubbed.value && Math.abs(touch.x - touchStartX.value) < TAB_SCRUB_SLOP) return;
        scrubbed.value = true;
        followFinger(touch.x, true);
      })
      .onTouchesUp((event, manager) => {
        "worklet";
        if (event.numberOfTouches > 0) return;
        const touch = event.changedTouches[0];
        if (touch) touchX.value = touch.x;
        manager.end();
      })
      .onTouchesCancelled((_event, manager) => {
        "worklet";
        manager.fail();
      })
      .onFinalize((_event, success) => {
        "worklet";
        const nextIndex = success
          ? tabIndexForPosition(touchX.value, directGroupWidth, directTabCount)
          : -1;
        const nextOffset = nextIndex >= 0 ? nextIndex * directTabCellWidth : restingOffset;
        // The lens stays lifted until it reaches the destination, then lands.
        // Navigation waits for the arrival: mounting a screen mid-flight would
        // stall the main thread that Reanimated draws the travel on.
        const wasScrubbed = scrubbed.value;
        const arrive = () => {
          "worklet";
          if (nextIndex < 0) return;
          if (wasScrubbed) runOnJS(commitTabSelection)(nextIndex);
          else runOnJS(pressTab)(nextIndex);
        };
        if (reducedMotion) {
          selectionOffset.value = nextOffset;
          lift.value = 0;
          lensShown.value = 0;
          arrive();
        } else {
          // Arrive on the cell with the system ease-out, then land at once.
          selectionOffset.value = withSpring(nextOffset, TAB_TRAVEL_SPRING, (finished) => {
            // An interrupting touch replaces this travel and keeps the lens up.
            if (!finished) return;
            arrive();
            lift.value = withSpring(0, PRESS_LENS_SPRING, (landed) => {
              if (landed) lensShown.value = 0;
            });
          });
        }
      });
  }, [
    dockBackGesture,
    lensShown,
    lift,
    commitTabSelection,
    directGroupWidth,
    directTabCellWidth,
    directTabCount,
    pressTab,
    reducedMotion,
    scrubbed,
    selectedDirectTabIndex,
    selectionOffset,
    touchStartX,
    touchX,
  ]);

  const barGrowthStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + PRESS_BAR_GROWTH * lift.value }],
  }));

  const sideEdge = sideRegion.edge;
  if (sideEdge) {
    return (
      <VerticalTabBar
        colorScheme={colorScheme}
        directTabs={directTabs}
        liquidGlass={liquidGlass}
        onTabPress={onTabPress}
        overflow={overflow}
        pathname={pathname}
        reducedMotion={reducedMotion}
        edge={sideEdge}
        size={sideRegion.size}
        surfaceComponent={surfaceComponent}
        tabletRail={sideRegion.tabletRail === true}
        testID={testID}
        theme={theme}
        bottomPadding={bottomPadding}
      />
    );
  }

  return (
    <View
      style={{
        backgroundColor: theme.transparent,
        bottom: 0,
        flexDirection: "row",
        gap: 8,
        left: 0,
        paddingBottom: bottomPadding,
        paddingHorizontal: Math.max(ROUTER_TAB_BAR_HORIZONTAL_PADDING, bottomPadding),
        paddingTop: tabBarVerticalPadding,
        position: "absolute",
        right: 0,
        zIndex: 10,
      }}
    >
      <GestureDetector gesture={tabScrubGesture}>
        <Animated.View
          testID={`${testID}-direct-group`}
          onLayout={({ nativeEvent }) => {
            const width = nativeEvent.layout.width;
            setDirectGroupWidth((current) => (current === width ? current : width));
          }}
          style={[{ flex: 1, height: tabBarHeight }, barGrowthStyle]}
        >
          <TabSurface
            colorScheme={colorScheme}
            liquidGlass={liquidGlass}
            reducedMotion={reducedMotion}
            surfaceComponent={surfaceComponent}
            style={{ borderRadius: tabBarHeight / 2, flex: 1 }}
            theme={theme}
          >
            <TabSelectionBlob
              cellWidth={directTabCellWidth}
              colorScheme={colorScheme}
              itemHeight={tabItemHeight}
              liquidGlass={liquidGlass}
              selectionInset={tabItemVerticalInset}
              offset={selectionOffset}
              lift={lift}
              selected={selectedDirectTabIndex >= 0}
              theme={theme}
            />
            {directTabs.map((tab, index) => (
              <TabTrigger key={tab.name} asChild name={tab.name}>
                <RouterTabButton
                  activeOverride={tab.isActive ? isTabActive(pathname, tab) : undefined}
                  icon={tab.icon}
                  label={tab.label}
                  registerPress={(press) => {
                    tabPresses.current[index] = press;
                  }}
                  gestureOwnsTouch={() => lensShown.value === 1}
                  onTabPress={(fromGesture) => {
                    // The bar gesture already moves the lens; this path is VoiceOver and keyboards.
                    const targetOffset = index * directTabCellWidth;
                    if (!fromGesture)
                      selectionOffset.value = reducedMotion
                        ? targetOffset
                        : withSpring(targetOffset, TAB_SELECTION_SPRING);
                    onTabPress?.(tab, index === selectedDirectTabIndex);
                  }}
                  selectedIcon={tab.selectedIcon}
                  itemHeight={tabItemHeight}
                  testID={tab.testID ?? `${testID}-${tab.name}`}
                  theme={theme}
                />
              </TabTrigger>
            ))}
          </TabSurface>
          {liquidGlass ? (
            <TabPressLens
              barHeight={tabBarHeight}
              cellWidth={directTabCellWidth}
              colorScheme={colorScheme}
              itemHeight={tabItemHeight}
              offset={selectionOffset}
              groupWidth={directGroupWidth}
              lift={lift}
              selectionInset={tabItemVerticalInset}
              shown={lensShown}
            />
          ) : null}
        </Animated.View>
      </GestureDetector>

      {overflow ? (
        <TabSurface
          colorScheme={colorScheme}
          liquidGlass={liquidGlass}
          reducedMotion={reducedMotion}
          surfaceComponent={surfaceComponent}
          style={{
            borderRadius: tabBarHeight / 2,
            height: tabBarHeight,
            width: tabBarHeight,
          }}
          testID={`${testID}-overflow-group`}
          theme={theme}
        >
          {overflow}
        </TabSurface>
      ) : null}
    </View>
  );
}

/**
 * The tab bar standing in the side column the system reserves on a foldable
 * iPhone (outer display, inner display in landscape, and the outer edge of a
 * Split View half). Bottom-aligned below the system indicators, symbol-only,
 * on the same physical side as the system's own bars. The column lies in the
 * padding the frame leaves beside the content, so nothing overlaps.
 */
function VerticalTabBar({
  bottomPadding,
  colorScheme,
  directTabs,
  liquidGlass,
  onTabPress,
  overflow,
  pathname,
  reducedMotion,
  edge,
  size,
  surfaceComponent,
  tabletRail,
  testID,
  theme,
}: {
  bottomPadding: number;
  colorScheme: RouterTabsColorScheme;
  directTabs: RouterTabItem[];
  liquidGlass: boolean;
  onTabPress?: (tab: RouterTabItem, wasSelected: boolean) => void;
  overflow?: ReactNode;
  pathname: string;
  reducedMotion: boolean;
  edge: "left" | "right";
  size: number;
  surfaceComponent: RouterTabsSurfaceComponent;
  tabletRail: boolean;
  testID: string;
  theme: RouterTabsTheme;
}) {
  const cell = ROUTER_TAB_BAR_VERTICAL_CELL;
  // The system's own column (its back, bell and add controls) is 44 pt wide, 20 pt in from the
  // display's edge. The bar's cells match that, in a pill with a 4 pt rim, centred on the same line.
  const barWidth = tabletRail ? size - 24 : ROUTER_TAB_BAR_VERTICAL_WIDTH;
  const columnInset = tabletRail ? 12 : 20 - (barWidth - cell) / 2;
  return (
    <View
      pointerEvents="box-none"
      style={{
        alignItems: edge === "right" ? "flex-end" : "flex-start",
        bottom: 0,
        gap: 8,
        justifyContent: tabletRail ? "flex-start" : "flex-end",
        paddingTop: tabletRail ? 88 : 0,
        paddingBottom: bottomPadding,
        ...(edge === "right" ? { paddingRight: columnInset } : { paddingLeft: columnInset }),
        position: "absolute",
        top: 0,
        width: size,
        zIndex: 10,
        // The side the system reserved; the tab content is padded away from it.
        ...(edge === "right" ? { right: 0 } : { left: 0 }),
      }}
    >
      <TabSurface
        colorScheme={colorScheme}
        liquidGlass={liquidGlass}
        reducedMotion={reducedMotion}
        surfaceComponent={surfaceComponent}
        style={{
          alignItems: "center",
          borderRadius: tabletRail ? 20 : barWidth / 2,
          flexDirection: "column",
          gap: 4,
          paddingHorizontal: tabletRail ? 4 : 0,
          paddingVertical: 4,
          width: barWidth,
        }}
        testID={`${testID}-vertical`}
        theme={theme}
      >
        {directTabs.map((tab) => (
          <TabTrigger key={tab.name} asChild name={tab.name}>
            <RouterTabButton
              activeOverride={tab.isActive ? isTabActive(pathname, tab) : undefined}
              icon={tab.icon}
              itemHeight={cell}
              label={tab.label}
              onTabPress={() => onTabPress?.(tab, isTabActive(pathname, tab))}
              selectedIcon={tab.selectedIcon}
              testID={tab.testID ?? `${testID}-${tab.name}`}
              theme={theme}
              vertical
              labelled={tabletRail}
            />
          </TabTrigger>
        ))}
      </TabSurface>
      {overflow ? (
        <TabSurface
          colorScheme={colorScheme}
          liquidGlass={liquidGlass}
          reducedMotion={reducedMotion}
          surfaceComponent={surfaceComponent}
          style={{
            alignItems: "center",
            borderRadius: ROUTER_TAB_BAR_VERTICAL_WIDTH / 2,
            height: ROUTER_TAB_BAR_VERTICAL_WIDTH,
            justifyContent: "center",
            width: ROUTER_TAB_BAR_VERTICAL_WIDTH,
          }}
          testID={`${testID}-overflow-group`}
          theme={theme}
        >
          {overflow}
        </TabSurface>
      ) : null}
    </View>
  );
}

function isTabActive(pathname: string, tab: RouterTabItem): boolean {
  if (tab.isActive) return tab.isActive(pathname);
  const activePath = normalizeRoutePath(pathname);
  const tabPath = normalizeRoutePath(typeof tab.href === "string" ? tab.href : `/${tab.name}`);
  return activePath === tabPath || activePath.startsWith(`${tabPath}/`);
}

function normalizeRoutePath(path: string): string {
  const withoutQuery = path.split(/[?#]/, 1)[0] ?? "/";
  const withoutGroups = withoutQuery.replace(/\/\([^/]+\)/g, "");
  const withoutTrailingSlash = withoutGroups.replace(/\/$/, "");
  return withoutTrailingSlash || "/";
}

function selectionOffsetForPosition(position: number, width: number, tabCount: number): number {
  "worklet";
  if (width <= 0 || tabCount <= 0) return 0;
  const cellWidth = width / tabCount;
  const maxOffset = Math.max(0, width - cellWidth);
  const centeredOffset = position - cellWidth / 2;
  return Math.min(maxOffset, Math.max(0, centeredOffset));
}

function tabIndexForPosition(position: number, width: number, tabCount: number): number {
  "worklet";
  if (width <= 0 || tabCount <= 0) return -1;
  const cellWidth = width / tabCount;
  return Math.min(tabCount - 1, Math.max(0, Math.floor(Math.max(0, position) / cellWidth)));
}

/** TabTrigger's press only checks that the event was not default-prevented. */
const GESTURE_PRESS_EVENT = {
  defaultPrevented: false,
  isDefaultPrevented: () => false,
  preventDefault: () => {},
} as unknown as GestureResponderEvent;

type RouterTabButtonProps = Omit<TabTriggerSlotProps, "children"> & {
  /** Replaces the trigger's route-focus state when a tab supplies `isActive`. */
  activeOverride?: boolean;
  icon: ReactNode;
  itemHeight: number;
  label: string;
  onTabPress?: (fromGesture?: boolean) => void;
  selectedIcon?: ReactNode;
  theme: RouterTabsTheme;
  /** Receives this cell's complete press for a gesture that owns the bar's touches. */
  registerPress?: (press: () => void) => void;
  /**
   * True while the bar gesture owns the touch. The cell's Pressable still
   * sees that touch (it is not cancelled), so its press and long press must
   * stand down; VoiceOver and keyboard activation never set it.
   */
  gestureOwnsTouch?: () => boolean;
  /** Symbol only, with its own selection lens: the bar stands in a narrow side column. */
  vertical?: boolean;
  labelled?: boolean;
};

const RouterTabButton = forwardRef<View, RouterTabButtonProps>(function RouterTabButton(
  {
    accessibilityState,
    activeOverride,
    href: _href,
    icon,
    itemHeight,
    isFocused: triggerFocused = false,
    label,
    onLongPress,
    onPress,
    onTabPress,
    registerPress,
    gestureOwnsTouch,
    selectedIcon,
    theme,
    vertical = false,
    labelled = false,
    ...props
  },
  ref,
) {
  const isFocused = activeOverride ?? triggerFocused;
  // The latest TabTrigger press, rebound every render as its focus changes.
  registerPress?.(() => {
    onTabPress?.(true);
    onPress?.(GESTURE_PRESS_EVENT);
  });
  if (vertical) {
    // Foldable columns keep symbols; the wider tablet sidebar can show the labels.
    return (
      <Pressable
        ref={ref}
        {...props}
        accessible
        accessibilityLabel={label}
        accessibilityRole="tab"
        accessibilityState={{ ...accessibilityState, selected: isFocused }}
        onLongPress={onLongPress}
        onPress={(event) => {
          onTabPress?.();
          onPress?.(event);
        }}
        style={({ pressed }) => ({
          cursor: "pointer",
          alignItems: "center",
          backgroundColor: isFocused ? theme.selectedSurface : theme.transparent,
          borderCurve: "continuous",
          borderRadius: labelled ? 16 : itemHeight / 2,
          flexDirection: labelled ? "row" : "column",
          gap: labelled ? 12 : 0,
          minHeight: itemHeight,
          justifyContent: labelled ? "flex-start" : "center",
          paddingHorizontal: labelled ? 12 : 0,
          paddingVertical: labelled ? 10 : 0,
          opacity: pressed ? 0.65 : 1,
          width: labelled ? "100%" : itemHeight,
        })}
      >
        {isFocused ? (selectedIcon ?? icon) : icon}
        {labelled ? (
          <Text
            maxFontSizeMultiplier={CHROME_MAX_FONT_SIZE_MULTIPLIER}
            adjustsFontSizeToFit
            minimumFontScale={CHROME_MIN_FONT_SCALE}
            numberOfLines={1}
            style={{
              color: theme.label,
              flex: 1,
              fontSize: type.callout.fontSize,
              fontWeight: isFocused ? "600" : "400",
            }}
          >
            {label}
          </Text>
        ) : null}
      </Pressable>
    );
  }
  return (
    <Pressable
      ref={ref}
      {...props}
      accessible
      accessibilityLabel={label}
      accessibilityRole="tab"
      accessibilityState={{ ...accessibilityState, selected: isFocused }}
      onLongPress={(event) => {
        if (gestureOwnsTouch?.()) return;
        onLongPress?.(event);
      }}
      onPress={(event) => {
        if (gestureOwnsTouch?.()) return;
        onTabPress?.();
        onPress?.(event);
      }}
      style={({ pressed }) => ({
        cursor: "pointer",
        alignItems: "center",
        backgroundColor: theme.transparent,
        borderCurve: "continuous",
        borderRadius: itemHeight / 2,
        flex: 1,
        flexDirection: "column",
        justifyContent: "center",
        minHeight: itemHeight,
        opacity: pressed ? 0.65 : 1,
        paddingHorizontal: 0,
      })}
    >
      {isFocused ? (selectedIcon ?? icon) : icon}
      <Text
        adjustsFontSizeToFit
        maxFontSizeMultiplier={CHROME_MAX_FONT_SIZE_MULTIPLIER}
        minimumFontScale={CHROME_MIN_FONT_SCALE}
        numberOfLines={1}
        style={{
          alignSelf: "stretch",
          color: isFocused ? theme.selectedLabel : theme.label,
          flexShrink: 1,
          fontSize: type.caption.fontSize,
          fontWeight: isFocused ? "600" : "500",
          lineHeight: 15,
          maxWidth: "100%",
          textAlign: "center",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
});

function TabSelectionBlob({
  cellWidth,
  colorScheme,
  itemHeight,
  lift,
  liquidGlass,
  selected,
  selectionInset,
  offset,
  theme,
}: {
  cellWidth: number;
  colorScheme: RouterTabsColorScheme;
  itemHeight: number;
  /** Shows the lens while a touch scrubs a bar with no selected direct tab. */
  lift: SharedValue<number>;
  liquidGlass: boolean;
  selected: boolean;
  selectionInset: number;
  offset: SharedValue<number>;
  theme: RouterTabsTheme;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: selected ? 1 : Math.min(1, lift.value * 2),
    transform: [{ translateX: offset.value }],
  }));

  if (cellWidth <= 0) return null;

  return (
    <Animated.View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[
        {
          height: itemHeight,
          left: selectionInset,
          position: "absolute",
          top: selectionInset,
          width: Math.max(0, cellWidth - selectionInset * 2),
        },
        animatedStyle,
      ]}
    >
      {liquidGlass ? (
        <ExpoGlassView
          colorScheme={colorScheme}
          glassEffectStyle="regular"
          isInteractive
          style={{ borderRadius: itemHeight / 2, flex: 1 }}
        />
      ) : (
        <View
          style={{
            backgroundColor: theme.selectedSurface,
            borderCurve: "continuous",
            borderRadius: itemHeight / 2,
            boxShadow: theme.shadow,
            flex: 1,
          }}
        />
      )}
    </Animated.View>
  );
}

/**
 * H55: the system tab bar's pressed lens. While a finger is down it lifts out
 * of the bar as a wide clear Liquid Glass capsule above the cells, growing
 * past the bar's edges; the native glass magnifies and refracts the cells
 * under it. Release settles it back onto the resting lens once it arrives.
 */
function TabPressLens({
  barHeight,
  cellWidth,
  colorScheme,
  groupWidth,
  itemHeight,
  offset,
  lift,
  selectionInset,
  shown,
}: {
  barHeight: number;
  cellWidth: number;
  colorScheme: RouterTabsColorScheme;
  groupWidth: number;
  itemHeight: number;
  offset: SharedValue<number>;
  lift: SharedValue<number>;
  selectionInset: number;
  /** 1 while pressed or landing; 0 parks the lens off-screen. */
  shown: SharedValue<number>;
}) {
  const restingWidth = Math.max(0, cellWidth - selectionInset * 2);
  const height = barHeight + PRESS_LENS_OUTSET * 2;
  const width = cellWidth * PRESS_LENS_CELLS;
  const left = selectionInset + restingWidth / 2 - width / 2;
  // At rest it matches the resting lens exactly, so appearing and leaving
  // are seamless; the brief non-uniform scale is hidden under that lens.
  const restScaleX = restingWidth / width;
  const restScaleY = itemHeight / height;
  // Always mounted and never faded or React-toggled: UIKit drops the glass
  // effect under a translucent parent, a glass view switched to `none` and
  // back stops rendering (expo/expo#43732), and a mount per press arrives
  // frames late. Off-screen parking is a plain translate on the UI thread.
  const lensStyle = useAnimatedStyle(() => {
    const scaleX = restScaleX + (1 - restScaleX) * lift.value;
    // Keep the widened lens over the bar at the first and last cells.
    const half = (width * scaleX) / 2;
    const centre = left + width / 2 + offset.value;
    const clamped = Math.min(
      groupWidth + PRESS_LENS_OUTSET - half,
      Math.max(-PRESS_LENS_OUTSET + half, centre),
    );
    return {
      transform: [
        { translateX: clamped - left - width / 2 },
        { translateY: shown.value ? 0 : LENS_PARKED_Y },
        { scaleX },
        { scaleY: restScaleY + (1 - restScaleY) * lift.value },
      ],
    };
  });

  if (cellWidth <= 0) return null;

  return (
    <Animated.View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[{ height, left, position: "absolute", top: -PRESS_LENS_OUTSET, width }, lensStyle]}
    >
      <ExpoGlassView
        colorScheme={colorScheme}
        glassEffectStyle="clear"
        style={{
          borderCurve: "continuous",
          borderRadius: height / 2,
          flex: 1,
          overflow: "hidden",
        }}
      />
    </Animated.View>
  );
}

function TabSurface({
  colorScheme,
  children,
  liquidGlass,
  reducedMotion,
  surfaceComponent,
  style,
  testID,
  theme,
}: {
  colorScheme: RouterTabsColorScheme;
  children: ReactNode;
  liquidGlass: boolean;
  reducedMotion: boolean;
  surfaceComponent: RouterTabsSurfaceComponent;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  theme: RouterTabsTheme;
}) {
  const borderColor = colorScheme === "dark" ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.14)";
  const baseStyle: ViewStyle = {
    borderColor,
    borderWidth: 0.5,
    borderCurve: "continuous",
    borderRadius: ROUTER_TAB_BAR_HEIGHT / 2,
    boxShadow: liquidGlass ? undefined : theme.shadow,
    flexDirection: "row",
    overflow: "hidden",
  };
  const surfaceStyle: StyleProp<ViewStyle> = [
    baseStyle,
    !liquidGlass ? { backgroundColor: theme.surface } : undefined,
    style,
  ];

  return (
    <SurfaceComponent
      colorScheme={colorScheme}
      isInteractive={true}
      mode={liquidGlass ? "liquid-glass" : "opaque"}
      reducedMotion={reducedMotion}
      surfaceComponent={surfaceComponent}
      style={surfaceStyle}
      testID={testID}
    >
      {children}
    </SurfaceComponent>
  );
}

function SurfaceComponent({
  colorScheme,
  children,
  isInteractive,
  mode,
  reducedMotion,
  surfaceComponent,
  style,
  testID,
}: RouterTabsSurfaceProps & { surfaceComponent: RouterTabsSurfaceComponent }) {
  const Surface = surfaceComponent;
  return (
    <Surface
      colorScheme={colorScheme}
      isInteractive={isInteractive}
      mode={mode}
      reducedMotion={reducedMotion}
      style={style}
      testID={testID}
    >
      {children}
    </Surface>
  );
}

function DefaultRouterTabsSurface({
  colorScheme,
  children,
  isInteractive,
  mode,
  style,
  testID,
}: RouterTabsSurfaceProps) {
  if (mode === "liquid-glass") {
    return (
      <ExpoGlassView
        colorScheme={colorScheme}
        glassEffectStyle="clear"
        isInteractive={isInteractive}
        style={style}
        testID={testID}
      >
        {children}
      </ExpoGlassView>
    );
  }

  return (
    <View style={style} testID={testID}>
      {children}
    </View>
  );
}
