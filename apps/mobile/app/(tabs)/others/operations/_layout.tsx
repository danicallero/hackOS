import { Slot } from "expo-router";
import { Stack } from "expo-router/stack";
import { useLocale } from "@/lib/i18n";
import { nativeStackScreenOptions } from "@/lib/navigation";
import { useSearchInToolbar } from "@/lib/side-region";
import { isPadIdiom } from "@/lib/tabs";

/**
 * iPad/macOS leaves this route in the parent Others stack so its controls can
 * integrate with the regular-width header. Compact devices reach it as a
 * header-less pseudo-tab, so it still needs its own stack to provide the title
 * and search.
 */
export default function OperationsLayout() {
  const searchInToolbar = useSearchInToolbar();
  const { t } = useLocale();
  if (isPadIdiom()) return <Slot />;

  return (
    <Stack screenOptions={nativeStackScreenOptions}>
      <Stack.Screen
        name="index"
        options={{
          headerLargeTitle: true,
          title: t("tabQueueOperations"),
          headerSearchBarOptions: {
            placeholder: t("queueOpsSearchPlaceholder"),
            autoCapitalize: "none",
            hideWhenScrolling: true,
            allowToolbarIntegration: searchInToolbar,
            placement: "integratedButton",
          },
        }}
      />
    </Stack>
  );
}
