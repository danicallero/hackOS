import { Redirect } from "expo-router";
import { OthersHubScreen } from "@/components/others-hub-screen";
import { useMeContext } from "@/lib/me-context";
import { useTabPresentation } from "@/lib/tab-presentation";
import { isPadIdiom } from "@/lib/tabs";

/**
 * Normal overflow selections open their pseudo-tab directly from the custom
 * native menu. This route remains a safe landing screen for direct `/others`
 * links: regular-width iPad/macOS can render the full fallback hub, while
 * compact devices keep the participant-friendly Account redirect.
 */
export default function OthersMenuScreen() {
  const { me } = useMeContext();
  const presentation = useTabPresentation(me?.capabilities ?? [], {
    hasQueueItems: me?.hasQueueItems ?? false,
  });
  if (presentation.overflow.length > 0 && isPadIdiom()) return <OthersHubScreen />;
  return <Redirect href="/(tabs)/others/account" />;
}
