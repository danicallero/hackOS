import Stack from "expo-router/stack";
import { createContext, type ReactElement, useContext } from "react";

import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import { useSideRegion } from "@/lib/side-region";

const AsToolbarMenuContext = createContext(false);

/** True inside a `ToolbarFilterSlot` that stands in a side column: render a native menu item. */
export function useFilterAsToolbarMenu(): boolean {
  return useContext(AsToolbarMenuContext);
}

/**
 * Where a right-toolbar filter goes. Normally a custom view in the bar; beside a side
 * column on a foldable iPhone the system can move only native items into its vertical
 * bar, so the filter inside renders as a `Stack.Toolbar.Menu` there (the system also
 * adds the item's own background, which is why no shared-background flag is set).
 */
export function ToolbarFilterSlot({ children }: { children: ReactElement }) {
  const inColumn = Boolean(useSideRegion().edge) && isRealLiquidGlassAvailable();
  if (inColumn) {
    return <AsToolbarMenuContext.Provider value>{children}</AsToolbarMenuContext.Provider>;
  }
  return <Stack.Toolbar.View hidesSharedBackground>{children}</Stack.Toolbar.View>;
}
