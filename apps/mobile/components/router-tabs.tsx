import { type Href, usePathname } from "expo-router";
import {
  TabList,
  TabSlot,
  Tabs,
  TabTrigger,
  type TabTriggerSlotProps,
  useTabTrigger,
} from "expo-router/ui";
import { forwardRef, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  type ColorSchemeName,
  type ColorValue,
  Pressable,
  type StyleProp,
  Text,
  useColorScheme,
  View,
  type ViewStyle,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  runOnJS,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { GlassView, isRealLiquidGlassAvailable } from "@/components/glass-view";
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

export interface RouterTabItem {
  href: Href;
  icon: ReactNode;
  label: string;
  name: string;
  selectedIcon?: ReactNode;
  testID?: string;
}

export interface RouterTabRoute {
  href: Href;
  name: string;
}

export interface RouterTabsTheme {
  barBackground: ColorValue;
  icon: ColorValue;
  label: ColorValue;
  selectedIcon: ColorValue;
  selectedLabel: ColorValue;
  selectedSurface: ColorValue;
  shadow?: string;
  surface: ColorValue;
  transparent: ColorValue;
}

export interface RouterTabsProps {
  /** Direct destinations. Five fit when no overflow control is supplied. */
  tabs: RouterTabItem[];
  /** Full route registry, including destinations hidden behind the overflow. */
  routes?: RouterTabRoute[];
  /** A ready-to-render overflow button. It is placed in its own circle. */
  overflow?: ReactNode;
  onTabPress?: (tab: RouterTabItem) => void;
  /** Called after a direct tab is released, including a scrubbed selection. */
  onTabSelect?: (index: number) => void;
  /** Direct-cell budget when the overflow control is present. */
  maxDirectTabs?: number;
  /** Direct-cell budget when no overflow control is present. */
  maxTabsWithoutOverflow?: number;
  /** Optional screen-surface scheme for opaque fallbacks such as a dark scanner. */
  fallbackColorScheme?: ColorSchemeName;
  testID?: string;
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
  fallbackColorScheme,
  maxDirectTabs = MAX_DIRECT_TABS,
  maxTabsWithoutOverflow = MAX_TABS_WITHOUT_OVERFLOW,
  testID = "router-tabs",
  theme,
}: RouterTabsProps) {
  const liquidGlass = isRealLiquidGlassAvailable();
  const systemScheme = useColorScheme();
  const resolvedTheme = liquidGlass
    ? theme
    : resolveFallbackTheme(theme, fallbackColorScheme ?? systemScheme);
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

function resolveFallbackTheme(
  theme: RouterTabsTheme,
  colorScheme: ColorSchemeName,
): RouterTabsTheme {
  if (colorScheme === "dark") {
    return {
      ...theme,
      barBackground: "#000000",
      icon: "#98989e",
      label: "#98989e",
      selectedIcon: "#0a84ff",
      selectedLabel: "#0a84ff",
      selectedSurface: "#2c2c2e",
      surface: "#1c1c1e",
    };
  }

  return {
    ...theme,
    barBackground: "#f2f2f7",
    icon: "#6c6c70",
    label: "#6c6c70",
    selectedIcon: "#007aff",
    selectedLabel: "#007aff",
    selectedSurface: "#e5e5ea",
    surface: "#ffffff",
  };
}

interface RouterTabsContentProps {
  directTabs: RouterTabItem[];
  liquidGlass: boolean;
  onTabPress?: (tab: RouterTabItem) => void;
  onTabSelect?: (index: number) => void;
  overflow?: ReactNode;
  testID: string;
  theme: RouterTabsTheme;
}

function RouterTabsContent({
  directTabs,
  liquidGlass,
  onTabPress,
  onTabSelect,
  overflow,
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

    selectionOffset.value = withSpring(
      selectedDirectTabIndex * directTabCellWidth,
      TAB_SELECTION_SPRING,
    );
  }, [directTabCellWidth, selectedDirectTabIndex, selectionOffset]);

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
            selectionOffset.value = withSpring(
              nextIndex * directTabCellWidth,
              TAB_SELECTION_SPRING,
            );
            runOnJS(commitTabSelection)(nextIndex);
          }
        }
        runOnJS(setIsScrubbing)(false);
      });
  }, [commitTabSelection, directGroupWidth, directTabCellWidth, directTabCount, selectionOffset]);

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
            style={{ borderRadius: tabBarHeight / 2, flex: 1 }}
            theme={theme}
          >
            <TabSelectionBlob
              cellWidth={directTabCellWidth}
              itemHeight={tabItemHeight}
              selectionInset={tabItemVerticalInset}
              liquidGlass={liquidGlass}
              offset={selectionOffset}
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
  theme,
  visible,
}: {
  cellWidth: number;
  itemHeight: number;
  selectionInset: number;
  liquidGlass: boolean;
  offset: SharedValue<number>;
  theme: RouterTabsTheme;
  visible: boolean;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  if (!visible || cellWidth <= 0) return null;

  return (
    <Animated.View
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
      <GlassView
        isInteractive={liquidGlass}
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
  style,
  testID,
  theme,
}: {
  children: ReactNode;
  liquidGlass: boolean;
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
    <GlassView isInteractive={liquidGlass} style={surfaceStyle} testID={testID}>
      {children}
    </GlassView>
  );
}
