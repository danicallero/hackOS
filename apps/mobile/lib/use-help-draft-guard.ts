import { useNavigation } from "expo-router";
import { usePreventRemove } from "expo-router/react-navigation";
import { alert } from "./alert";
import { useLocale } from "./i18n";

/** H61/H64: native Back/swipe must not silently discard a pending form. */
export function useHelpDraftGuard(dirty: boolean, busy: boolean) {
  const navigation = useNavigation();
  const { t } = useLocale();
  usePreventRemove(dirty || busy, ({ data }) => {
    if (busy) return;
    alert(t("helpDiscardConfirm"), undefined, [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("helpDiscard"),
        style: "destructive",
        onPress: () => navigation.dispatch(data.action),
      },
    ]);
  });
}
