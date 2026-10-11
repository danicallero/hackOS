/** Gap between the safe-area top and the floating wallet button (H28). */
export const ACCOUNT_WALLET_BUTTON_GAP = 8;
/** Diameter of the floating wallet button, the same as a native back button. */
export const ACCOUNT_WALLET_BUTTON_SIZE = 44;

export type WalletToggleIconFrame = { opacity: number; rotate: number; scale: number };

/**
 * H28: the Account wallet button morphs into a close button in place. At
 * `progress` 0 the wallet glyph shows; at 1 the X does. The two glyphs
 * crossfade while turning a quarter-turn in the same direction, so the X
 * reads as the wallet glyph rotating into it. Rotation is in degrees.
 */
export function walletToggleIconFrames(progress: number): {
  wallet: WalletToggleIconFrame;
  close: WalletToggleIconFrame;
} {
  "worklet";
  const p = Math.min(1, Math.max(0, progress));
  return {
    wallet: { opacity: 1 - p, rotate: p * 90, scale: 1 - 0.4 * p },
    close: { opacity: p, rotate: (p - 1) * 90, scale: 0.6 + 0.4 * p },
  };
}

/** Top of the wallet button and the scroll inset that keeps content below it. */
export function accountWalletChrome(safeAreaTop: number, platform: string) {
  const buttonTop = safeAreaTop + ACCOUNT_WALLET_BUTTON_GAP;
  const below = ACCOUNT_WALLET_BUTTON_GAP + ACCOUNT_WALLET_BUTTON_SIZE;
  return {
    buttonTop,
    // iOS's automatic content inset already clears the status bar; Android
    // has no native bar here, so the wallet scroll adds the inset itself.
    walletContentTop: platform === "ios" ? below : safeAreaTop + below,
  };
}
