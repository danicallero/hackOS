import { useSideRegion } from "@/lib/side-region";
import { colors } from "@/theme/colors";
import { SCREEN_TITLE } from "@/theme/screen-title";

/**
 * Header options for a top-level screen's title. On a phone the native large title collapses
 * as the list scrolls. Beside a side column it sits on the bar row at the same size and line as
 * every other top-level title (Schedule, Scanner, Activities, Contacts), not a row lower.
 */
export function useBarTitleOptions(title: string) {
  const side = useSideRegion();
  // A tablet rail is a side column too: the title shares the bar row with the other tabs' titles.
  const compact = Boolean(side.edge) || side.tabletRail;
  return compact
    ? ({
        title,
        headerLargeTitle: false,
        headerTitleAlign: "left",
        headerTitleStyle: { color: colors.label, ...SCREEN_TITLE },
        headerShadowVisible: false,
      } as const)
    : ({ title, headerLargeTitle: true } as const);
}
