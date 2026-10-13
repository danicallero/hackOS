import type { Href, ImperativeRouter } from "expo-router";

/**
 * Shared `screenOptions` for every native Stack. iOS 26 draws a chevron-only
 * back item as a circular Liquid Glass button; any back title (the default
 * mode shows the previous screen's title, e.g. a root-level detail pushed over
 * the tab navigator) widens it into a capsule. The long-press back menu is
 * off too: it lists previous screens by title, and a detail pushed over the
 * tab navigator would offer the route group's name, "(tabs)".
 */
export const nativeStackScreenOptions = {
  headerBackButtonDisplayMode: "minimal",
  headerBackButtonMenuEnabled: false,
} as const;

/**
 * Keep the native stack back action while removing the app-bar surface and
 * dynamic route title from detail screens.
 */
export const transparentDetailHeaderOptions = {
  headerBackButtonDisplayMode: "minimal",
  headerBackButtonMenuEnabled: false,
  headerBackTitle: "",
  headerBlurEffect: "none",
  headerLargeTitle: false,
  headerShadowVisible: false,
  headerShown: true,
  headerStyle: { backgroundColor: "transparent" },
  headerTitle: "",
  headerTransparent: true,
  title: "",
} as const;

/**
 * Back buttons are also rendered on routes that can be opened directly from a
 * notification or a deep link. In that case there is no stack entry to pop;
 * replacing with the owning surface keeps the button useful without sending
 * an unhandled GO_BACK action through React Navigation.
 *
 * The optional members make the helper friendly to the small router doubles
 * used by unit tests while the real Expo Router object always provides them.
 */
export function safeBack(
  router: Pick<ImperativeRouter, "back"> & Partial<Pick<ImperativeRouter, "canGoBack" | "replace">>,
  fallback: Href,
): void {
  if (router.canGoBack?.()) {
    router.back();
    return;
  }
  if (router.replace) {
    router.replace(fallback);
    return;
  }
  // Test doubles from older screen tests only implemented `back`; preserving
  // that behavior keeps those tests useful without weakening production flow.
  router.back();
}
