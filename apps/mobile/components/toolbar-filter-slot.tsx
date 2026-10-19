import Stack from "expo-router/stack";
import type { ReactElement } from "react";

import type { FilterMenu, FilterMenuProps } from "@/components/filter-menu";
import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import { useSideRegion } from "@/lib/side-region";
import { colors } from "@/theme/colors";

/** True when a filter in the right toolbar should be a native item (a side column holds the bar). */
export function useFilterInToolbarColumn(): boolean {
  return Boolean(useSideRegion().edge) && isRealLiquidGlassAvailable();
}

/**
 * A right-toolbar filter. Normally a custom view in the bar; beside a side column on a
 * foldable iPhone the system can move only native items into its vertical bar, so the
 * same filter renders as a `Stack.Toolbar.Menu` there. Call it as a function inside a
 * `Stack.Toolbar` (the toolbar only reads its direct children, not wrapper components).
 */
export function toolbarFilter(
  menu: ReactElement<FilterMenuProps, typeof FilterMenu>,
  inColumn: boolean,
) {
  const { items, accessibilityLabel, active, onSelect } = menu.props;
  if (!inColumn) {
    return <Stack.Toolbar.View hidesSharedBackground>{menu}</Stack.Toolbar.View>;
  }
  return (
    <Stack.Toolbar.Menu
      icon="line.3.horizontal.decrease"
      accessibilityLabel={accessibilityLabel}
      tintColor={active ? colors.accent : undefined}
    >
      {items.map((item) => (
        <Stack.Toolbar.MenuAction
          key={item.id}
          isOn={item.selected}
          unstable_keepPresented
          onPress={() => onSelect(item.id)}
        >
          {item.label}
        </Stack.Toolbar.MenuAction>
      ))}
    </Stack.Toolbar.Menu>
  );
}
