import { useEffect, useState } from "react";
import { BackHandler, Platform, Pressable, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassView } from "@/components/glass-view";
import { AndroidStatusBarScrim } from "@/components/native-ui";
import { SymbolView } from "@/components/symbol";
import WalletScreen from "@/components/wallet-screen";
import {
  ACCOUNT_WALLET_BUTTON_SIZE,
  accountWalletChrome,
  walletToggleIconFrames,
} from "@/lib/account-wallet-toggle";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { colors } from "@/theme/colors";

const MORPH_MS = 220;

/**
 * H28: Wallet lives in Account. A back-button-sized glass circle in the
 * header's top-left corner opens the wallet as an overlay of this screen and
 * then becomes its close button. An overlay, not a pushed or modal route,
 * keeps that one button in place across both states so its glyph can morph;
 * a route transition would slide or cover it. The `others/wallet` route stays
 * for deep links.
 */
export function AccountWallet() {
  const { t } = useLocale();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const progress = useSharedValue(0);
  const chrome = accountWalletChrome(insets.top, Platform.OS);

  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, { duration: reduceMotion ? 0 : MORPH_MS });
  }, [open, progress, reduceMotion]);

  // Android's system back closes the wallet before it leaves Account.
  useEffect(() => {
    if (!open) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setOpen(false);
      return true;
    });
    return () => subscription.remove();
  }, [open]);

  const walletIconStyle = useAnimatedStyle(() => {
    const { wallet } = walletToggleIconFrames(progress.value);
    return {
      opacity: wallet.opacity,
      transform: [{ rotate: `${wallet.rotate}deg` }, { scale: wallet.scale }],
    };
  });
  const closeIconStyle = useAnimatedStyle(() => {
    const { close } = walletToggleIconFrames(progress.value);
    return {
      opacity: close.opacity,
      transform: [{ rotate: `${close.rotate}deg` }, { scale: close.scale }],
    };
  });

  return (
    <>
      {open ? (
        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(MORPH_MS)}
          exiting={reduceMotion ? undefined : FadeOut.duration(MORPH_MS)}
          testID="account-wallet-overlay"
          style={{
            backgroundColor: colors.background,
            bottom: 0,
            left: 0,
            position: "absolute",
            right: 0,
            top: 0,
            // Above the collapsing avatar's overlay (z 21).
            zIndex: 30,
          }}
        >
          <WalletScreen contentTopInset={chrome.walletContentTop} />
          <AndroidStatusBarScrim />
        </Animated.View>
      ) : null}
      <GlassView
        glassEffectStyle="regular"
        isInteractive
        style={{
          borderRadius: ACCOUNT_WALLET_BUTTON_SIZE / 2,
          height: ACCOUNT_WALLET_BUTTON_SIZE,
          left: 16,
          position: "absolute",
          top: chrome.buttonTop,
          width: ACCOUNT_WALLET_BUTTON_SIZE,
          zIndex: 31,
        }}
      >
        <Pressable
          testID="account-wallet-button"
          accessibilityLabel={open ? t("close") : t("tabWallet")}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => {
            void haptic("light");
            setOpen((current) => !current);
          }}
          style={({ pressed }) => ({
            alignItems: "center",
            flex: 1,
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <View style={{ height: 22, width: 22 }}>
            <Animated.View style={[iconLayer, walletIconStyle]}>
              <SymbolView
                accessible={false}
                name="wallet.pass"
                size={19}
                tintColor={colors.label}
                weight="semibold"
              />
            </Animated.View>
            <Animated.View style={[iconLayer, closeIconStyle]}>
              <SymbolView
                accessible={false}
                name="xmark"
                size={19}
                tintColor={colors.label}
                weight="semibold"
              />
            </Animated.View>
          </View>
        </Pressable>
      </GlassView>
    </>
  );
}

const iconLayer = {
  alignItems: "center",
  bottom: 0,
  justifyContent: "center",
  left: 0,
  position: "absolute",
  right: 0,
  top: 0,
} as const;
