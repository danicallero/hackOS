import { Redirect } from "expo-router";
import { OthersHubScreen } from "@/components/others-hub-screen";
import { useMeContext } from "@/lib/me-context";
import { isPadIdiom, shouldUseOverflowMenu } from "@/lib/tabs";

/**
 * With no overflow tabs this is Account, reached by every participant's
 * fifth bar tab. Overflow users get here two different ways: on iPhone the
 * popover in app/(tabs)/_layout.tsx intercepts the tap before this route
 * ever mounts, so the redirect below is dead code in practice but is kept
 * as the safe fallback; on iPad/macOS there's no popover, so this really is
 * the "Others" tab's landing screen and renders the real hub list.
 */
export default function OthersMenuScreen() {
  const { me } = useMeContext();
  if (shouldUseOverflowMenu(me?.capabilities ?? []) && isPadIdiom()) return <OthersHubScreen />;
  return <Redirect href="/(tabs)/others/account" />;
}
