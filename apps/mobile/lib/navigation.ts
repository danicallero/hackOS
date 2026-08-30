import type { Href, ImperativeRouter } from "expo-router";

/**
 * Keep the native stack back action while removing the app-bar surface and
 * dynamic route title from detail screens.
 */
export const transparentDetailHeaderOptions = {
  headerBackButtonDisplayMode: "minimal",
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
