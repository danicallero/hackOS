import { createElement, Fragment, type ReactElement, type ReactNode } from "react";
import { Text } from "react-native";
import { colors } from "@/theme/colors";
import { CHROME_MAX_FONT_SIZE_MULTIPLIER } from "@/theme/dynamic-type";
import { SCREEN_TITLE } from "@/theme/screen-title";

/**
 * The top-level title of a screen's native bar (Scanner, Activities, Schedule, Contacts): plain
 * text in `SCREEN_TITLE` with no shared glass capsule behind it, so it reads the same wherever it
 * is drawn and switching tabs never makes it jump. The pane stacks build their root header from
 * this so they cannot diverge from the single-pane routes.
 */
export function screenTitleElement(title: string): ReactElement {
  return createElement(
    Text,
    {
      accessibilityRole: "header",
      maxFontSizeMultiplier: CHROME_MAX_FONT_SIZE_MULTIPLIER,
      style: { color: colors.label, flexShrink: 1, ...SCREEN_TITLE },
    },
    title,
  );
}

/**
 * Native-stack options of a pane's root screen: transparent bar without a shadow, the plain title
 * leading (its shared background hidden) and the screen's actions trailing, which are already
 * glass circles of their own.
 */
export function paneRootHeaderOptions({ title, trailing }: { title: string; trailing: ReactNode }) {
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
    unstable_headerRightItems: () => [
      {
        type: "custom" as const,
        element: createElement(Fragment, null, trailing),
        hidesSharedBackground: true,
      },
    ],
  };
}
