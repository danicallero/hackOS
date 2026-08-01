import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { FloatingBackButton } from "@/components/native-ui";
import { isPadIdiom } from "@/lib/tabs";

/**
 * Back affordance for the Others-hub detail screens (Queue/Wallet/Account —
 * see OthersHubScreen) on iPad/macOS, which are header-less like every
 * other screen here (app/(tabs)/others/_layout.tsx) so the top NativeTabs
 * bar doesn't get a second title bar stacked underneath it. Renders nothing
 * on iPhone, where these same screens are reached via `router.replace` and
 * have no "back" to offer.
 */
export function HubDetailBackButton() {
  const router = useRouter();
  const { top } = useSafeAreaInsets();
  if (!isPadIdiom()) return null;
  return <FloatingBackButton top={top + 12} onPress={() => router.back()} />;
}
