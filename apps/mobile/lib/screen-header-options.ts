import { createElement, type ReactElement } from "react";
import { Text } from "react-native";
import { type PaneBarItem, withBarGaps } from "@/lib/pane-header-items";
import { colors } from "@/theme/colors";
import { CHROME_MAX_FONT_SIZE_MULTIPLIER } from "@/theme/dynamic-type";
import { SCREEN_TITLE } from "@/theme/screen-title";

/**
 * The top-level title of a screen's native bar (Scanner, Activities, Schedule, Contacts): plain
 * text in `SCREEN_TITLE` with no shared glass capsule behind it, so it reads the same wherever it
 * is drawn and switching tabs never makes it jump. The pane stacks and the single-pane Scanner
 * build their title from this so they cannot diverge.
 */
export function screenTitleElement(
  title: string,
  extra: { testID?: string; numberOfLines?: number } = {},
): ReactElement {
  return createElement(
    Text,
    {
      ...extra,
      accessibilityRole: "header",
      maxFontSizeMultiplier: CHROME_MAX_FONT_SIZE_MULTIPLIER,
      style: { color: colors.label, flexShrink: 1, ...SCREEN_TITLE },
    },
    title,
  );
}

/**
 * Native-stack options of a pane's root screen: a bar without a shadow, the plain title leading
 * (its shared background hidden) and the screen's actions trailing as real bar items, each its own
 * glass circle.
 */
export function paneRootHeaderOptions({
  title,
  trailing,
}: {
  title: string;
  trailing: Array<Exclude<PaneBarItem, { type: "spacing" }>>;
}) {
  return {
    headerShadowVisible: false,
    headerStyle: { backgroundColor: colors.background },
    headerTransparent: false,
    title: "",
    unstable_headerLeftItems: () => [
      {
        type: "custom" as const,
        element: screenTitleElement(title),
        hidesSharedBackground: true,
      },
    ],
    unstable_headerRightItems: () => withBarGaps(trailing),
  };
}
