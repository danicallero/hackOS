import { useFocusEffect, useRouter } from "expo-router";
import { useCallback } from "react";
import { ActionSheetIOS, Alert, View } from "react-native";

import { useLocale } from "@/lib/i18n";
import { useMeContext } from "@/lib/me-context";
import { visibleTabs } from "@/lib/tabs";
import { colors } from "@/theme/colors";

/** Opens the system action menu whenever the circular Others tab is selected. */
export default function OthersMenuScreen() {
  const router = useRouter();
  const { t } = useLocale();
  const { me } = useMeContext();
  const canScan = visibleTabs(me?.capabilities ?? []).includes("scan");

  useFocusEffect(
    useCallback(() => {
      const choices = [
        { label: t("tabAccount"), route: "/(tabs)/others/account" as const },
        ...(canScan ? [{ label: t("tabScan"), route: "/(tabs)/others/scan" as const }] : []),
      ];
      const cancelIndex = choices.length;

      const choose = (index: number) => {
        const choice = choices[index];
        if (choice) router.replace(choice.route);
        else if (router.canGoBack()) router.back();
        else router.replace("/(tabs)/schedule");
      };

      const timer = setTimeout(() => {
        if (process.env.EXPO_OS === "ios") {
          ActionSheetIOS.showActionSheetWithOptions(
            {
              cancelButtonIndex: cancelIndex,
              options: [...choices.map((choice) => choice.label), t("cancel")],
              title: t("tabOthers"),
            },
            choose,
          );
          return;
        }

        Alert.alert(
          t("tabOthers"),
          undefined,
          [
            ...choices.map((choice, index) => ({
              text: choice.label,
              onPress: () => choose(index),
            })),
            { text: t("cancel"), style: "cancel" },
          ],
          { cancelable: true },
        );
      }, 0);

      return () => clearTimeout(timer);
    }, [canScan, router, t]),
  );

  return <View style={{ backgroundColor: colors.background, flex: 1 }} />;
}
