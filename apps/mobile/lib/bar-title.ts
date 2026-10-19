import { useSideRegion } from "@/lib/side-region";
import { SCREEN_TITLE } from "@/theme/screen-title";

/**
 * Header options for a top-level screen's title. On a phone the native large title collapses
 * as the list scrolls. Beside a side column it sits on the bar row at the same size and line as
 * every other top-level title (Schedule, Scanner, Activities, Contacts), not a row lower.
 */
export function useBarTitleOptions(title: string) {
  const compact = Boolean(useSideRegion().edge);
  return compact
    ? ({
        title,
        headerLargeTitle: false,
        headerTitleAlign: "left",
        headerTitleStyle: { ...SCREEN_TITLE },
      } as const)
    : ({ title, headerLargeTitle: true } as const);
}
