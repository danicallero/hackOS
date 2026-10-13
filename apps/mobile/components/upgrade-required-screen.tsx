import { Linking, Platform } from "react-native";

import { AuthButton, AuthHeader, AuthScreen } from "@/components/auth-ui";
import { storeUrl } from "@/lib/env";
import { useLocale } from "@/lib/i18n";

/** Blocking screen shown once the API answers 426 `upgrade_required` (#999). */
export function UpgradeRequiredScreen() {
  const { t } = useLocale();
  return (
    <AuthScreen>
      <AuthHeader
        icon="arrow.down.circle"
        title={t("upgradeRequiredTitle")}
        description={t("upgradeRequiredBody")}
      />
      <AuthButton
        label={t("upgradeRequiredAction")}
        onPress={() => void Linking.openURL(storeUrl(Platform.OS))}
        testID="upgrade-required-action"
      />
    </AuthScreen>
  );
}
