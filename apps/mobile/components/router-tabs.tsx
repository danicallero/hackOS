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
  useState,
} from "react";
import {
  type ColorValue,
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
import {
  RouterTabBarInsetsProvider,
  ROUTER_TAB_BAR_HEIGHT as TAB_BAR_HEIGHT,
  useRouterTabBarInsets,
} from "@/lib/router-tabs-inset";

export type { RouterTabBarInsets } from "@/lib/router-tabs-inset";
export {
  useRouterTabBarBottomInset,
  useRouterTabBarInsets,
  useRouterTabBarScrollBottomInset,
} from "@/lib/router-tabs-inset";

export const MAX_DIRECT_TABS = 4;
export const MAX_TABS_WITHOUT_OVERFLOW = MAX_DIRECT_TABS + 1;
export const ROUTER_TAB_BAR_HEIGHT = TAB_BAR_HEIGHT;
export const ROUTER_TAB_OVERFLOW_WIDTH = ROUTER_TAB_BAR_HEIGHT;
const ROUTER_TAB_BAR_HORIZONTAL_PADDING = 16;
const TAB_SELECTION_SPRING = { damping: 20, mass: 0.8, stiffness: 220 };

export type RouterTabsSurfaceMode = "liquid-glass" | "opaque";

/** Props a custom tab-surface renderer must accept. */
export interface RouterTabsSurfaceProps {
  children?: ReactNode;
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

/** True only when the current Expo runtime can render native Liquid Glass. */
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
  onTabPress?: (tab: RouterTabItem) => void;
  /** Side effects after a direct tab release, including a scrub selection. */
  onTabSelect?: (index: number) => void;
  /** Direct-cell budget when `overflow` is present; defaults to four. */
  maxDirectTabs?: number;
  /** Direct-cell budget without `overflow`; defaults to five. */
  maxTabsWithoutOverflow?: number;
  /** Theme overrides for opaque fallbacks on intentionally themed screens. */
  fallbackTheme?: Partial<RouterTabsTheme>;
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
  surfaceComponent = DefaultRouterTabsSurface,
  testID = "router-tabs",
  theme,
}: RouterTabsProps) {
  const liquidGlass = isRouterTabsLiquidGlassAvailable();
  const resolvedTheme = liquidGlass ? theme : { ...theme, ...fallbackTheme };
  const directTabLimit = overflow ? maxDirectTabs : maxTabsWithoutOverflow;
  const directTabs = tabs.slice(0, directTabLimit);
  const registeredRoutes = routes ?? tabs.map(({ href, name }) => ({ href, name }));

  if (__DEV__ && tabs.length > directTabLimit) {
    console.warn(
      `[router-tabs] Received ${tabs.length} direct tabs; only ${directTabLimit} are rendered. ` +
        "Move the remaining destinations to the overflow menu.",
    );
  }

  return (
    <RouterTabBarInsetsProvider>
      <Tabs style={{ flex: 1 }} testID={testID}>
        <TabSlot style={{ flex: 1 }} />
        <RouterTabsContent
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
  directTabs: RouterTabItem[];
  liquidGlass: boolean;
  onTabPress?: (tab: RouterTabItem) => void;
  onTabSelect?: (index: number) => void;
  overflow?: ReactNode;
  surfaceComponent: RouterTabsSurfaceComponent;
  testID: string;
  theme: RouterTabsTheme;
}

function RouterTabsContent({
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
  const [isScrubbing, setIsScrubbing] = useState(false);
  const selectionOffset = useSharedValue(0);
  const directTabCellWidth = directTabCount > 0 ? directGroupWidth / directTabCount : 0;
  const tabItemHeight = tabBarHeight - tabBarVerticalPadding;
  const tabItemVerticalInset = (tabBarHeight - tabItemHeight) / 2;

  useEffect(() => {
    if (selectedDirectTabIndex < 0 || directTabCellWidth <= 0) {
      cancelAnimation(selectionOffset);
      selectionOffset.value = 0;
      return;
    }

    const nextOffset = selectedDirectTabIndex * directTabCellWidth;
    selectionOffset.value = reducedMotion
      ? nextOffset
      : withSpring(nextOffset, TAB_SELECTION_SPRING);
  }, [directTabCellWidth, reducedMotion, selectedDirectTabIndex, selectionOffset]);

  const commitTabSelection = useCallback(
    (nextIndex: number) => {
      const nextName = directTabNames[nextIndex];
      if (nextName === undefined) return;

      onTabSelect?.(nextIndex);

      // Pan gestures do not pass through TabTrigger's Pressable, so mirror
      // its tabPress emission before jumping. Ordinary taps stay on
      // TabTrigger's Pressable and emit that event (which Schedule uses to
      // jump to the live activity); a scrubbed selection only needs the
      // router's tab state transition here.
      if (nextIndex === selectedDirectTabIndex) return;
      switchTab(nextName, {});
    },
    [directTabNames, onTabSelect, selectedDirectTabIndex, switchTab],
  );

  const tabScrubGesture = useMemo(() => {
    // Let each TabTrigger own ordinary taps. Pan only takes ownership after
    // six points, so tapping an active tab still emits the native tabPress
    // event while a horizontal drag keeps the lens attached to the finger.
    return Gesture.Pan()
      .activeOffsetX([-6, 6])
      .failOffsetY([-14, 14])
      .enabled(directTabCount > 0 && directTabCellWidth > 0)
      .onStart(() => {
        "worklet";
        cancelAnimation(selectionOffset);
        runOnJS(setIsScrubbing)(true);
      })
      .onUpdate((event) => {
        "worklet";
        selectionOffset.value = selectionOffsetForPosition(
          event.x,
          directGroupWidth,
          directTabCount,
        );
      })
      .onFinalize((event, success) => {
        "worklet";
        if (success) {
          const nextIndex = tabIndexForPosition(event.x, directGroupWidth, directTabCount);
          if (nextIndex >= 0) {
            const nextOffset = nextIndex * directTabCellWidth;
            selectionOffset.value = reducedMotion
              ? nextOffset
              : withSpring(nextOffset, TAB_SELECTION_SPRING);
            runOnJS(commitTabSelection)(nextIndex);
          }
        }
        runOnJS(setIsScrubbing)(false);
      });
  }, [
    commitTabSelection,
    directGroupWidth,
    directTabCellWidth,
    directTabCount,
    reducedMotion,
    selectionOffset,
  ]);

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
        <View
          onLayout={({ nativeEvent }) => {
            const width = nativeEvent.layout.width;
            setDirectGroupWidth((current) => (current === width ? current : width));
          }}
          style={{ flex: 1, height: tabBarHeight }}
        >
          <TabSurface
            liquidGlass={liquidGlass}
            reducedMotion={reducedMotion}
            surfaceComponent={surfaceComponent}
            style={{ borderRadius: tabBarHeight / 2, flex: 1 }}
            theme={theme}
          >
            <TabSelectionBlob
              cellWidth={directTabCellWidth}
              itemHeight={tabItemHeight}
              selectionInset={tabItemVerticalInset}
              liquidGlass={liquidGlass}
              offset={selectionOffset}
              reducedMotion={reducedMotion}
              surfaceComponent={surfaceComponent}
              theme={theme}
              visible={selectedDirectTabIndex >= 0 || isScrubbing}
            />
            {directTabs.map((tab) => (
              <TabTrigger key={tab.name} asChild name={tab.name}>
                <RouterTabButton
                  icon={tab.icon}
                  label={tab.label}
                  onTabPress={() => onTabPress?.(tab)}
                  selectedIcon={tab.selectedIcon}
                  itemHeight={tabItemHeight}
                  testID={tab.testID ?? `${testID}-${tab.name}`}
                  theme={theme}
                />
              </TabTrigger>
            ))}
          </TabSurface>
        </View>
      </GestureDetector>

      {overflow ? (
        <TabSurface
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

function isTabActive(pathname: string, tab: RouterTabItem): boolean {
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

type RouterTabButtonProps = Omit<TabTriggerSlotProps, "children"> & {
  icon: ReactNode;
  itemHeight: number;
  label: string;
  onTabPress?: () => void;
  selectedIcon?: ReactNode;
  theme: RouterTabsTheme;
};

const RouterTabButton = forwardRef<View, RouterTabButtonProps>(function RouterTabButton(
  {
    accessibilityState,
    href: _href,
    icon,
    itemHeight,
    isFocused = false,
    label,
    onLongPress,
    onPress,
    onTabPress,
    selectedIcon,
    theme,
    ...props
  },
  ref,
) {
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
        numberOfLines={1}
        style={{
          alignSelf: "stretch",
          color: isFocused ? theme.selectedLabel : theme.label,
          flexShrink: 1,
          fontSize: 12,
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
  itemHeight,
  selectionInset,
  liquidGlass,
  offset,
  reducedMotion,
  surfaceComponent,
  theme,
  visible,
}: {
  cellWidth: number;
  itemHeight: number;
  selectionInset: number;
  liquidGlass: boolean;
  offset: SharedValue<number>;
  reducedMotion: boolean;
  surfaceComponent: RouterTabsSurfaceComponent;
  theme: RouterTabsTheme;
  visible: boolean;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  if (!visible || cellWidth <= 0) return null;

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
      <SurfaceComponent
        isInteractive={liquidGlass}
        mode={liquidGlass ? "liquid-glass" : "opaque"}
        reducedMotion={reducedMotion}
        surfaceComponent={surfaceComponent}
        style={{
          backgroundColor: !liquidGlass ? theme.selectedSurface : undefined,
          borderCurve: "continuous",
          borderRadius: itemHeight / 2,
          boxShadow: theme.shadow,
          flex: 1,
        }}
      />
    </Animated.View>
  );
}

function TabSurface({
  children,
  liquidGlass,
  reducedMotion,
  surfaceComponent,
  style,
  testID,
  theme,
}: {
  children: ReactNode;
  liquidGlass: boolean;
  reducedMotion: boolean;
  surfaceComponent: RouterTabsSurfaceComponent;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  theme: RouterTabsTheme;
}) {
  const baseStyle: ViewStyle = {
    borderCurve: "continuous",
    borderRadius: ROUTER_TAB_BAR_HEIGHT / 2,
    boxShadow: theme.shadow,
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
      isInteractive={liquidGlass}
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
  children,
  isInteractive,
  mode,
  style,
  testID,
}: RouterTabsSurfaceProps) {
  if (mode === "liquid-glass") {
    return (
      <ExpoGlassView isInteractive={isInteractive} style={style} testID={testID}>
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
