import { type MenuAction, MenuView } from "@expo/ui/community/menu";
import { NavigationBar } from "expo-navigation-bar";
import type { Href } from "expo-router";
import { usePathname, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import type { SFSymbol } from "expo-symbols";
import { useRef, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";

import { GlassView } from "@/components/glass-view";
import {
  type RouterTabItem,
  type RouterTabRoute,
  RouterTabs,
  type RouterTabsSurfaceProps,
  type RouterTabsTheme,
} from "@/components/router-tabs";
import { SymbolView } from "@/components/symbol";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import {
  operationsSectionFromPathname,
  resolveOperationsNavigationAction,
} from "@/lib/operations-navigation";
import {
  OVERFLOW_TAB_ICON,
  OVERFLOW_TAB_LABEL_KEY,
  OVERFLOW_TAB_ROUTE,
  type OverflowTabKey,
} from "@/lib/overflow-tabs";
import {
  routerTabBarDirectTabsForWidth,
  routerTabBarMaxTabsWithoutOverflowForWidth,
  useRouterTabBarInsets,
} from "@/lib/router-tabs-inset";
import { isDarkScannerSurface } from "@/lib/scanner-surface";
import { overflowTabs, primaryTabs, type TabKey } from "@/lib/tabs";
import { colors } from "@/theme/colors";

type TabLabelKey =
  | "tabAccount"
  | "tabActivities"
  | "tabNotifications"
  | "tabQueue"
  | "tabQueueOperations"
  | "tabScan"
  | "tabSchedule"
  | "tabWallet";

interface TabDefinition {
  href: Href;
  icon: SFSymbol;
  labelKey: TabLabelKey;
  selectedIcon?: SFSymbol;
  triggerName: string;
}

/** H55 app adapter: capability-aware destinations for the reusable tab shell. */
const TAB_DEFINITIONS: Record<TabKey, TabDefinition> = {
  schedule: {
    href: "/(tabs)/schedule",
    icon: "calendar",
    labelKey: "tabSchedule",
    triggerName: "schedule",
  },
  queue: {
    href: "/(tabs)/queue",
    icon: "clock",
    labelKey: "tabQueue",
    selectedIcon: "clock.fill",
    triggerName: "queue",
  },
  wallet: {
    href: "/(tabs)/wallet",
    icon: "wallet.pass",
    labelKey: "tabWallet",
    selectedIcon: "wallet.pass.fill",
    triggerName: "wallet",
  },
  operations: {
    href: "/(tabs)/operations",
    icon: "rectangle.3.group",
    labelKey: "tabQueueOperations",
    selectedIcon: "rectangle.3.group.fill",
    triggerName: "operations",
  },
  scan: {
    href: "/(tabs)/scan",
    icon: "qrcode.viewfinder",
    labelKey: "tabScan",
    triggerName: "scan",
  },
  activities: {
    href: "/(tabs)/activities",
    icon: "list.bullet.rectangle",
    labelKey: "tabActivities",
    selectedIcon: "list.bullet.rectangle.fill",
    triggerName: "activities",
  },
  notifications: {
    href: "/(tabs)/notifications",
    icon: "bell",
    labelKey: "tabNotifications",
    selectedIcon: "bell.fill",
    triggerName: "notifications",
  },
  account: {
    href: "/(tabs)/others",
    icon: "person.crop.circle",
    labelKey: "tabAccount",
    selectedIcon: "person.crop.circle.fill",
    triggerName: "others",
  },
};

const REGISTERED_TAB_ROUTES: RouterTabRoute[] = [
  { href: "/(tabs)/schedule", name: "schedule" },
  { href: "/(tabs)/queue", name: "queue" },
  { href: "/(tabs)/wallet", name: "wallet" },
  { href: "/(tabs)/operations", name: "operations" },
  { href: "/(tabs)/scan", name: "scan" },
  { href: "/(tabs)/activities", name: "activities" },
  { href: "/(tabs)/notifications", name: "notifications" },
  { href: "/(tabs)/others", name: "others" },
];

export interface OpaqueRouterTabsProps {
  capabilities: string[];
  hasQueueItems: boolean;
  hasUnreadNotifications: boolean;
}

/**
 * App-specific adapter for the reusable `RouterTabs` shell. The shell owns
 * the Liquid Glass/opaque geometry; this adapter owns hackOS capabilities,
 * copy, icons and the Others pseudo-tab menu.
 */
export function OpaqueRouterTabs({
  capabilities,
  hasQueueItems,
  hasUnreadNotifications,
}: OpaqueRouterTabsProps) {
  const { t } = useLocale();
  const pathname = usePathname();
  const systemColorScheme = useColorScheme();
  const { width } = useWindowDimensions();
  const darkScannerSurface = isDarkScannerSurface(pathname);
  const fallbackColorScheme: "dark" | "light" = darkScannerSurface
    ? "dark"
    : systemColorScheme === "dark"
      ? "dark"
      : "light";
  const tabIconColor = fallbackColorScheme === "dark" ? "#ffffff" : "#000000";
  const tabSelectedColor = fallbackColorScheme === "dark" ? "#0a84ff" : "#007aff";
  const personalTabContext = { hasQueueItems };
  const primaryTabKeys = primaryTabs(capabilities, personalTabContext);
  const overflowTabKeys = overflowTabs(capabilities, personalTabContext);
  const directTabLimit = routerTabBarDirectTabsForWidth(width);
  const maxTabsWithoutOverflow = routerTabBarMaxTabsWithoutOverflowForWidth(width);
  const allTabKeys = [...primaryTabKeys, ...overflowTabKeys];
  const showOverflow = allTabKeys.length > maxTabsWithoutOverflow;
  const directOverflowCount = Math.max(0, directTabLimit - primaryTabKeys.length);
  const visibleTabKeys = showOverflow
    ? [...primaryTabKeys, ...overflowTabKeys.slice(0, directOverflowCount)]
    : allTabKeys;
  const overflowIds = showOverflow ? overflowTabKeys.slice(directOverflowCount) : [];
  const tabs: RouterTabItem[] = visibleTabKeys.map((key) => {
    const definition = TAB_DEFINITIONS[key];
    const unread = key === "notifications" && hasUnreadNotifications;
    const icon = unread ? "bell.badge" : definition.icon;
    const selectedIcon = unread ? "bell.badge.fill" : definition.selectedIcon;

    return {
      href: definition.href,
      icon: (
        <SymbolView
          name={icon}
          size={22}
          tintColor={tabIconColor}
          weight="semibold"
          accessible={false}
        />
      ),
      label: t(definition.labelKey),
      name: definition.triggerName,
      selectedIcon: (
        <SymbolView
          name={selectedIcon ?? icon}
          size={22}
          tintColor={tabSelectedColor}
          weight="semibold"
          accessible={false}
        />
      ),
      testID: `opaque-tab-${key}`,
    };
  });
  const fallbackTheme: Partial<RouterTabsTheme> =
    fallbackColorScheme === "dark"
      ? {
          label: "#ffffff",
          selectedLabel: "#0a84ff",
          selectedSurface: "#2c2c2e",
          surface: "#1c1c1e",
        }
      : {
          label: "#000000",
          selectedLabel: "#007aff",
          selectedSurface: "#e5e5ea",
          surface: "#ffffff",
        };

  return (
    <>
      <StatusBar style={darkScannerSurface ? "light" : "auto"} />
      {Platform.OS === "android" ? (
        // expo-navigation-bar's `light` style means light system-button
        // content, keeping Android's navigation surface dark for the camera.
        <NavigationBar style={darkScannerSurface ? "light" : "auto"} />
      ) : null}
      <RouterTabs
        colorScheme={fallbackColorScheme}
        onTabPress={() => void haptic("selection")}
        onTabSelect={() => void haptic("selection")}
        overflow={
          overflowIds.length > 0 ? (
            <OpaqueOverflowMenu
              activeIconColor={tabSelectedColor}
              colorScheme={fallbackColorScheme}
              iconColor={tabIconColor}
              overflowIds={overflowIds}
            />
          ) : null
        }
        maxDirectTabs={directTabLimit}
        maxTabsWithoutOverflow={maxTabsWithoutOverflow}
        fallbackTheme={fallbackTheme}
        routes={REGISTERED_TAB_ROUTES}
        surfaceComponent={OpaqueRouterTabsSurface}
        tabs={tabs}
        testID="opaque-router-tabs"
        theme={{
          label: fallbackColorScheme === "dark" ? "#ffffff" : "#000000",
          selectedLabel: colors.accent,
          selectedSurface: colors.accentSurface,
          shadow: colors.controlShadow,
          surface: colors.surface,
          transparent: colors.transparent,
        }}
      />
    </>
  );
}

/**
 * The clear Liquid Glass material loses its perimeter against a light canvas,
 * making the tab bar read as an opaque white strip. Use the same regular,
 * interactive material as the app's other floating controls in light mode;
 * its native rim and refraction retain the liquid-glass affordance. Dark
 * surfaces keep the clearer treatment, where the surrounding contrast already
 * defines the bar cleanly.
 */
function OpaqueRouterTabsSurface({
  children,
  colorScheme,
  isInteractive,
  mode,
  style,
  testID,
}: RouterTabsSurfaceProps) {
  return (
    <GlassView
      colorScheme={colorScheme}
      glassEffectStyle={mode === "liquid-glass" && colorScheme === "light" ? "regular" : "clear"}
      isInteractive={isInteractive}
      style={style}
      testID={testID}
    >
      {children}
    </GlassView>
  );
}

interface OpaqueOverflowMenuProps {
  activeIconColor: string;
  /** Matches the surrounding tab bar's own light/dark resolution (system
   *  scheme everywhere, forced dark over the scanner's camera view) — only
   *  consumed by the Android card menu; iOS's native `MenuView` already
   *  adapts to the system appearance on its own. */
  colorScheme: "dark" | "light";
  iconColor: string;
  overflowIds: OverflowTabKey[];
}

interface OpaqueOperationsMenuItem extends MenuAction {
  id: OverflowTabKey;
  label: string;
  route: (typeof OVERFLOW_TAB_ROUTE)[OverflowTabKey];
}

/**
 * Android's `MenuView` falls back to a Material `DropdownMenu` (see
 * `@expo/ui`'s Jetpack Compose implementation) — a small system-styled list
 * anchored flush to the trigger, visually inconsistent with every other
 * rounded/grouped surface this app uses and nothing like the card-style
 * context menu iOS renders natively for the same `MenuView`. Android gets a
 * hand-rolled menu that reproduces that iOS card look instead (same anchored
 * `Modal` + `GlassView` recipe as `ScheduleFilterPanel`), so the Others
 * control reads the same on both platforms.
 */
function OpaqueOverflowMenu(props: OpaqueOverflowMenuProps) {
  return Platform.OS === "android" ? (
    <AndroidOverflowMenu {...props} />
  ) : (
    <NativeOverflowMenu {...props} />
  );
}

function NativeOverflowMenu({ activeIconColor, iconColor, overflowIds }: OpaqueOverflowMenuProps) {
  const { t } = useLocale();
  const { tabBarHeight } = useRouterTabBarInsets();
  const pathname = usePathname();
  const router = useRouter();
  const focusedSection = operationsSectionFromPathname(pathname);
  const activeOverflowId =
    focusedSection !== "external" && overflowIds.includes(focusedSection) ? focusedSection : null;
  const items: OpaqueOperationsMenuItem[] = overflowIds.map((id) => ({
    id,
    image: OVERFLOW_TAB_ICON[id],
    label: t(OVERFLOW_TAB_LABEL_KEY[id]),
    route: OVERFLOW_TAB_ROUTE[id],
    state: focusedSection === id ? "on" : "off",
    title: t(OVERFLOW_TAB_LABEL_KEY[id]),
  }));

  const onAction = ({ nativeEvent }: { nativeEvent: { event: string } }) => {
    const item = items.find(({ id }) => id === nativeEvent.event);
    if (!item) return;
    const action = resolveOperationsNavigationAction(pathname, item.route);
    if (action === "noop") return;
    router.replace(item.route);
  };

  return (
    <MenuView
      actions={items}
      onOpenMenu={() => void haptic("selection")}
      onPressAction={onAction}
      shouldOpenOnLongPress={false}
      style={{ height: tabBarHeight, width: tabBarHeight }}
      testID="opaque-others-menu"
    >
      <View
        accessible
        accessibilityLabel={
          activeOverflowId ? t(OVERFLOW_TAB_LABEL_KEY[activeOverflowId]) : t("tabOthers")
        }
        accessibilityRole="button"
        accessibilityState={{ selected: activeOverflowId !== null }}
        style={{
          alignItems: "center",
          borderRadius: tabBarHeight / 2,
          height: tabBarHeight,
          justifyContent: "center",
          width: tabBarHeight,
        }}
      >
        <SymbolView
          name={activeOverflowId ? OVERFLOW_TAB_ICON[activeOverflowId] : "ellipsis"}
          size={22}
          tintColor={activeOverflowId ? activeIconColor : iconColor}
          weight="semibold"
          accessible={false}
        />
      </View>
    </MenuView>
  );
}

const ANDROID_OVERFLOW_MENU_WIDTH = 230;
const ANDROID_OVERFLOW_MENU_Z_INDEX = 1000;
// Clearance between the trigger circle and the card, matching the gap
// `ScheduleFilterPanel` leaves under its own anchor.
const ANDROID_OVERFLOW_MENU_GAP = 8;

function AndroidOverflowMenu({
  activeIconColor,
  colorScheme,
  iconColor,
  overflowIds,
}: OpaqueOverflowMenuProps) {
  const { t } = useLocale();
  const { tabBarHeight } = useRouterTabBarInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const pathname = usePathname();
  const router = useRouter();
  const triggerRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<{ bottom: number; right: number } | null>(null);
  const focusedSection = operationsSectionFromPathname(pathname);
  const activeOverflowId =
    focusedSection !== "external" && overflowIds.includes(focusedSection) ? focusedSection : null;
  const items = overflowIds.map((id) => ({
    icon: OVERFLOW_TAB_ICON[id],
    id,
    label: t(OVERFLOW_TAB_LABEL_KEY[id]),
    route: OVERFLOW_TAB_ROUTE[id],
  }));

  function openMenu() {
    void haptic("selection");
    triggerRef.current?.measureInWindow((x, y, width) => {
      setAnchor({
        bottom: windowHeight - y + ANDROID_OVERFLOW_MENU_GAP,
        right: windowWidth - x - width,
      });
    });
  }

  function selectItem(item: (typeof items)[number]) {
    setAnchor(null);
    const action = resolveOperationsNavigationAction(pathname, item.route);
    if (action === "noop") return;
    router.replace(item.route);
  }

  return (
    <>
      <Pressable
        ref={triggerRef}
        accessibilityLabel={
          activeOverflowId ? t(OVERFLOW_TAB_LABEL_KEY[activeOverflowId]) : t("tabOthers")
        }
        accessibilityRole="button"
        accessibilityState={{ expanded: anchor !== null, selected: activeOverflowId !== null }}
        onPress={openMenu}
        style={{
          alignItems: "center",
          borderRadius: tabBarHeight / 2,
          height: tabBarHeight,
          justifyContent: "center",
          width: tabBarHeight,
        }}
        testID="opaque-others-menu"
      >
        <SymbolView
          name={activeOverflowId ? OVERFLOW_TAB_ICON[activeOverflowId] : "ellipsis"}
          size={22}
          tintColor={activeOverflowId ? activeIconColor : iconColor}
          weight="semibold"
          accessible={false}
        />
      </Pressable>
      {anchor ? (
        <Modal transparent visible animationType="fade" onRequestClose={() => setAnchor(null)}>
          <Pressable
            accessibilityLabel={t("close")}
            accessibilityRole="button"
            onPress={() => setAnchor(null)}
            style={{ flex: 1 }}
          >
            <View
              style={{
                bottom: anchor.bottom,
                position: "absolute",
                right: anchor.right,
                width: ANDROID_OVERFLOW_MENU_WIDTH,
                zIndex: ANDROID_OVERFLOW_MENU_Z_INDEX + 1,
              }}
            >
              <GlassView
                colorScheme={colorScheme}
                glassEffectStyle="regular"
                style={{
                  borderColor:
                    colorScheme === "dark" ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.08)",
                  borderCurve: "continuous",
                  borderRadius: 18,
                  borderWidth: 0.5,
                  elevation: 12,
                  overflow: "hidden",
                  shadowColor: "#000",
                  shadowOffset: { height: 6, width: 0 },
                  shadowOpacity: colorScheme === "dark" ? 0.4 : 0.15,
                  shadowRadius: 16,
                }}
              >
                {items.map((item, index) => (
                  <AndroidOverflowMenuRow
                    key={item.id}
                    colorScheme={colorScheme}
                    icon={item.icon}
                    label={item.label}
                    last={index === items.length - 1}
                    selected={item.id === activeOverflowId}
                    onPress={() => selectItem(item)}
                  />
                ))}
              </GlassView>
            </View>
          </Pressable>
        </Modal>
      ) : null}
    </>
  );
}

function AndroidOverflowMenuRow({
  colorScheme,
  icon,
  label,
  last,
  selected,
  onPress,
}: {
  colorScheme: "dark" | "light";
  icon: SFSymbol;
  label: string;
  last: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const dark = colorScheme === "dark";
  const labelColor = dark ? "white" : "black";
  const mutedIconColor = dark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.45)";

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={() => {
          void haptic("selection");
          onPress();
        }}
        style={{
          alignItems: "center",
          flexDirection: "row",
          gap: 10,
          paddingHorizontal: 14,
          paddingVertical: 12,
        }}
      >
        <Text
          selectable={false}
          style={{
            color: selected ? colors.accent : labelColor,
            flex: 1,
            fontSize: 15,
            fontWeight: selected ? "600" : "400",
          }}
        >
          {label}
        </Text>
        <SymbolView
          accessible={false}
          name={icon}
          tintColor={selected ? colors.accent : mutedIconColor}
          size={17}
        />
      </Pressable>
      {last ? null : (
        <View
          style={{
            backgroundColor: dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)",
            height: 0.5,
            marginLeft: 14,
          }}
        />
      )}
    </>
  );
}
