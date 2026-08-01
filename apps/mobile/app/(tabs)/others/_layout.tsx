import { Stack } from "expo-router/stack";

/**
 * Header-less on every platform, matching iPhone's flat pseudo-tab look
 * (see the navigation contract in app/(tabs)/_layout.tsx). On iPad/macOS,
 * screens pushed from the real hub (index — see OthersHubScreen) use a
 * `HubDetailBackButton` floating control instead of a native header, so the
 * top NativeTabs bar doesn't end up stacked on top of a second title bar.
 * `operations` keeps its own nested Stack/header, unrelated to this file.
 */
export default function OthersLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
