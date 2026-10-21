import { useRouter } from "expo-router";
import { Stack } from "expo-router/stack";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { isRealLiquidGlassAvailable } from "@/components/glass-view";
import { AdaptiveToolbarButton, AndroidStatusBarScrim } from "@/components/native-ui";
import WalletScreen from "@/components/wallet-screen";
import { ACCOUNT_WALLET_BUTTON_GAP, accountWalletChrome } from "@/lib/account-wallet-toggle";
import { useLocale } from "@/lib/i18n";
import { safeBack, transparentDetailHeaderOptions } from "@/lib/navigation";

/** H28: a directly opened Wallet needs a close action even without stack history. */
export default function WalletRoute() {
  const router = useRouter();
  const { t } = useLocale();
  const chrome = accountWalletChrome(useSafeAreaInsets().top, Platform.OS);
  const nativeToolbar = Platform.OS === "ios" && isRealLiquidGlassAvailable();

  return (
    <>
      <WalletScreen
        contentTopInset={nativeToolbar ? ACCOUNT_WALLET_BUTTON_GAP : chrome.walletContentTop}
      />
      <Stack.Screen
        options={
          nativeToolbar
            ? { ...transparentDetailHeaderOptions, headerBackVisible: false }
            : { headerShown: false }
        }
      />
      <AndroidStatusBarScrim />
      <AdaptiveToolbarButton
        top={chrome.buttonTop}
        icon="xmark"
        accessibilityLabel={t("close")}
        onPress={() => safeBack(router, "/others/account")}
      />
    </>
  );
}
