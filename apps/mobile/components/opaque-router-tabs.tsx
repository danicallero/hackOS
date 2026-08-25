import { type MenuAction, MenuView } from "@expo/ui/community/menu";
import type { Href } from "expo-router";
import { usePathname, useRouter } from "expo-router";
import type { SFSymbol } from "expo-symbols";
import { useColorScheme, useWindowDimensions, View } from "react-native";

import {
  type RouterTabItem,
  type RouterTabRoute,
  RouterTabs,
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
  hasUnreadNotifications: boolean;
}

/**
 * App-specific adapter for the reusable `RouterTabs` shell. The shell owns
 * the Liquid Glass/opaque geometry; this adapter owns hackOS capabilities,
 * copy, icons and the Others pseudo-tab menu.
 */
export function OpaqueRouterTabs({ capabilities, hasUnreadNotifications }: OpaqueRouterTabsProps) {
  const { t } = useLocale();
  const pathname = usePathname();
  const systemColorScheme = useColorScheme();
  const { width } = useWindowDimensions();
  const fallbackColorScheme = isDarkScannerSurface(pathname)
    ? "dark"
    : (systemColorScheme ?? "light");
  const tabIconColor = fallbackColorScheme === "dark" ? "#98989e" : "#6c6c70";
  const tabSelectedColor = fallbackColorScheme === "dark" ? "#0a84ff" : "#007aff";
  const primaryTabKeys = primaryTabs(capabilities);
  const overflowTabKeys = overflowTabs(capabilities);
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
          label: "#98989e",
          selectedLabel: "#0a84ff",
          selectedSurface: "#2c2c2e",
          surface: "#1c1c1e",
        }
      : {
          label: "#6c6c70",
          selectedLabel: "#007aff",
          selectedSurface: "#e5e5ea",
          surface: "#ffffff",
        };

  return (
    <RouterTabs
      onTabPress={() => void haptic("selection")}
      onTabSelect={() => void haptic("selection")}
      overflow={
        overflowIds.length > 0 ? (
          <OpaqueOverflowMenu
            activeIconColor={tabSelectedColor}
            iconColor={tabIconColor}
            overflowIds={overflowIds}
          />
        ) : null
      }
      maxDirectTabs={directTabLimit}
      maxTabsWithoutOverflow={maxTabsWithoutOverflow}
      fallbackTheme={fallbackTheme}
      routes={REGISTERED_TAB_ROUTES}
      tabs={tabs}
      testID="opaque-router-tabs"
      theme={{
        label: colors.secondaryLabel,
        selectedLabel: colors.accent,
        selectedSurface: colors.accentSurface,
        shadow: colors.controlShadow,
        surface: colors.surface,
        transparent: colors.transparent,
      }}
    />
  );
}

function isDarkScannerSurface(pathname: string): boolean {
  const routePath = pathname.replace(/\/\([^/]+\)/g, "");
  // The activity scanner uses a numeric activity route. People Finder is also
  // nested below `/activities`, but it is a light list surface and must not
  // inherit the scanner's dark tab bar after navigation from the camera.
  return routePath === "/scan" || /^\/activities\/\d+$/.test(routePath);
}

interface OpaqueOverflowMenuProps {
  activeIconColor: string;
  iconColor: string;
  overflowIds: OverflowTabKey[];
}

interface OpaqueOperationsMenuItem extends MenuAction {
  id: OverflowTabKey;
  label: string;
  route: (typeof OVERFLOW_TAB_ROUTE)[OverflowTabKey];
}

function OpaqueOverflowMenu({ activeIconColor, iconColor, overflowIds }: OpaqueOverflowMenuProps) {
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
