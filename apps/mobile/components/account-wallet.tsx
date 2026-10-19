import Stack from "expo-router/stack";
import { useCallback, useEffect, useState } from "react";
import { BackHandler, Modal, Platform, Pressable, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassView, isRealLiquidGlassAvailable } from "@/components/glass-view";
import { AndroidStatusBarScrim } from "@/components/native-ui";
import { SymbolView } from "@/components/symbol";
import WalletScreen from "@/components/wallet-screen";
import {
  ACCOUNT_WALLET_BUTTON_GAP,
  ACCOUNT_WALLET_BUTTON_SIZE,
  accountWalletChrome,
  walletToggleIconFrames,
} from "@/lib/account-wallet-toggle";
import { haptic } from "@/lib/haptics";
import { useLocale } from "@/lib/i18n";
import { useSideRegion } from "@/lib/side-region";
import { colors } from "@/theme/colors";

const MORPH_MS = 220;

export type AccountWalletController = ReturnType<typeof useAccountWallet>;

/**
 * H28: Wallet lives in Account. A back-button-sized glass circle at the top-left
 * of the scrolling content opens the wallet as an overlay of this screen; the
 * overlay carries its own close button in the same corner. The button scrolls
 * away with the content (it is not pinned), so at rest the overlay's X sits
 * exactly over it and the glyph morphs in place. An overlay, not a pushed or
 * modal route, keeps that corner steady across both states. The
 * `others/wallet` route stays for deep links.
 */
export function useAccountWallet() {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const progress = useSharedValue(0);

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

  const toggle = useCallback(() => {
    void haptic("light");
    setOpen((current) => !current);
  }, []);

  return { open, progress, reduceMotion, toggle };
}

/** The wallet glyph button; render it inside the Account scroll content. */
export function AccountWalletButton({ wallet }: { wallet: AccountWalletController }) {
  const chrome = accountWalletChrome(useSafeAreaInsets().top, Platform.OS);
  const { t } = useLocale();
  const sideRegion = useSideRegion();
  // Beside a side column the in-page circle cannot join the system's vertical bar;
  // a native toolbar item can (the Diary's wallet button is the same item).
  if (sideRegion.edge && isRealLiquidGlassAvailable()) {
    return (
      <Stack.Toolbar placement="left">
        {/* The same item becomes the close control while the wallet is open. */}
        <Stack.Toolbar.Button
          icon={wallet.open ? "xmark" : "wallet.pass"}
          accessibilityLabel={wallet.open ? t("close") : t("tabWallet")}
          onPress={wallet.toggle}
        />
      </Stack.Toolbar>
    );
  }
  return (
    <WalletToggleButton
      testID="account-wallet-button"
      wallet={wallet}
      glyph="wallet"
      top={chrome.scrollButtonTop}
    />
  );
}

/** The wallet overlay and its close button; render it over the whole screen. */
export function AccountWalletOverlay({ wallet }: { wallet: AccountWalletController }) {
  // Beside a side column the Account toolbar item itself turns into the close control.
  const toolbarCloses = Boolean(useSideRegion().edge) && isRealLiquidGlassAvailable();
  if (!wallet.open) return null;
  return (
    <Animated.View
      entering={wallet.reduceMotion ? undefined : FadeIn.duration(MORPH_MS)}
      exiting={wallet.reduceMotion ? undefined : FadeOut.duration(MORPH_MS)}
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
      <WalletOverlayContent
        wallet={wallet}
        closeTestID="account-wallet-close"
        toolbarCloses={toolbarCloses}
      />
    </Animated.View>
  );
}

/**
 * The same wallet and close button in a full-screen modal, for screens whose
 * native header would cover an in-page overlay (the Diary, #935). The close
 * button sits where the Account one does. It opens on the badge, the card
 * someone you meet scans.
 */
export function WalletModal({ wallet }: { wallet: AccountWalletController }) {
  return (
    <Modal
      visible={wallet.open}
      animationType="slide"
      onRequestClose={() => {
        if (wallet.open) wallet.toggle();
      }}
    >
      <View testID="wallet-modal" style={{ backgroundColor: colors.background, flex: 1 }}>
        <WalletOverlayContent
          wallet={wallet}
          closeTestID="wallet-modal-close"
          // The modal fills the rounded display: keep the button clear of the corner arc.
          cornerInset={12}
          initialPurpose="badge"
        />
      </View>
    </Modal>
  );
}

function WalletOverlayContent({
  closeTestID,
  cornerInset = 0,
  initialPurpose,
  toolbarCloses = false,
  wallet,
}: {
  /** Extra inset from the display's rounded corner, for a full-screen modal. */
  cornerInset?: number;
  closeTestID: string;
  initialPurpose?: "ticket" | "badge";
  wallet: AccountWalletController;
  /** The Account toolbar item is the close control, so no in-page button is drawn. */
  toolbarCloses?: boolean;
}) {
  const chrome = accountWalletChrome(useSafeAreaInsets().top, Platform.OS);
  return (
    <>
      <WalletScreen
        // No button row to clear when the toolbar item is the close control.
        contentTopInset={toolbarCloses ? ACCOUNT_WALLET_BUTTON_GAP : chrome.walletContentTop}
        initialPurpose={initialPurpose}
      />
      <AndroidStatusBarScrim />
      {toolbarCloses ? null : (
        <WalletToggleButton
          testID={closeTestID}
          wallet={wallet}
          glyph="close"
          left={16 + cornerInset}
          top={chrome.buttonTop + cornerInset}
        />
      )}
    </>
  );
}

function WalletToggleButton({
  glyph,
  left = 16,
  testID,
  top,
  wallet,
}: {
  glyph: "wallet" | "close";
  left?: number;
  testID: string;
  top: number;
  wallet: AccountWalletController;
}) {
  const { t } = useLocale();
  const { open, progress, toggle } = wallet;
  const iconStyle = useAnimatedStyle(() => {
    const frame = walletToggleIconFrames(progress.value)[glyph];
    return {
      opacity: frame.opacity,
      transform: [{ rotate: `${frame.rotate}deg` }, { scale: frame.scale }],
    };
  });

  return (
    <GlassView
      glassEffectStyle="regular"
      isInteractive
      style={{
        borderRadius: ACCOUNT_WALLET_BUTTON_SIZE / 2,
        height: ACCOUNT_WALLET_BUTTON_SIZE,
        left,
        position: "absolute",
        top,
        width: ACCOUNT_WALLET_BUTTON_SIZE,
        zIndex: 31,
      }}
    >
      <Pressable
        testID={testID}
        accessibilityLabel={glyph === "close" ? t("close") : t("tabWallet")}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={toggle}
        style={({ pressed }) => ({
          alignItems: "center",
          flex: 1,
          justifyContent: "center",
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Animated.View style={[iconLayer, iconStyle]}>
          <SymbolView
            accessible={false}
            name={glyph === "close" ? "xmark" : "wallet.pass"}
            size={19}
            tintColor={colors.label}
            weight="semibold"
          />
        </Animated.View>
      </Pressable>
    </GlassView>
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
