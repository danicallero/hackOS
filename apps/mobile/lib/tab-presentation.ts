import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  routerTabBarBottomPadding,
  routerTabBarDirectTabsForWidth,
  routerTabBarMaxTabsWithoutOverflowForWidth,
  routerTabBarVerticalBudget,
} from "@/lib/router-tabs-inset";
import { useSideRegion } from "@/lib/side-region";
import { overflowTabs, type PersonalTabContext, primaryTabs } from "@/lib/tabs";

/** H55: the overflow hub and bar must agree on which destinations are already visible. */
export function tabPresentation(
  capabilities: string[],
  context: PersonalTabContext,
  direct: number,
  withoutOverflow: number,
) {
  const primary = primaryTabs(capabilities, context);
  const secondary = overflowTabs(capabilities, context);
  const all = [...primary, ...secondary];
  const promoted = Math.max(0, direct - primary.length);
  // A menu holding a single destination is not worth its toggle. The overflow circle and a direct
  // cell take the same slot, so that last destination is shown as a tab instead.
  const loneOverflow = all.length > withoutOverflow && all.length === direct + 1;
  const hasOverflow = all.length > withoutOverflow && !loneOverflow;
  return {
    directLimit: direct,
    withoutOverflow: loneOverflow ? all.length : withoutOverflow,
    visible: hasOverflow ? [...primary, ...secondary.slice(0, promoted)] : all,
    overflow: hasOverflow ? secondary.slice(promoted) : [],
  };
}

export function useTabPresentation(capabilities: string[], context: PersonalTabContext) {
  const { width, height } = useWindowDimensions();
  const { bottom } = useSafeAreaInsets();
  const side = useSideRegion();
  const budget = side.edge
    ? routerTabBarVerticalBudget(
        height,
        routerTabBarBottomPadding(bottom),
        width,
        side.tabletRail === true,
      )
    : null;
  return tabPresentation(
    capabilities,
    context,
    budget?.direct ?? routerTabBarDirectTabsForWidth(width),
    budget?.withoutOverflow ?? routerTabBarMaxTabsWithoutOverflowForWidth(width),
  );
}
