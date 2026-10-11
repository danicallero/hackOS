import { accountWalletChrome, walletToggleIconFrames } from "./account-wallet-toggle";

describe("walletToggleIconFrames (H28)", () => {
  it("shows only the wallet glyph when closed and only the X when open", () => {
    expect(walletToggleIconFrames(0)).toEqual({
      wallet: { opacity: 1, rotate: 0, scale: 1 },
      close: { opacity: 0, rotate: -90, scale: 0.6 },
    });
    expect(walletToggleIconFrames(1)).toEqual({
      wallet: { opacity: 0, rotate: 90, scale: 0.6 },
      close: { opacity: 1, rotate: 0, scale: 1 },
    });
  });

  it("crossfades and turns both glyphs the same way mid-morph", () => {
    const { wallet, close } = walletToggleIconFrames(0.5);
    expect(wallet.opacity + close.opacity).toBe(1);
    expect(wallet.rotate - close.rotate).toBe(90);
    expect(wallet.scale).toBeCloseTo(close.scale);
  });

  it("clamps spring overshoot outside 0..1", () => {
    expect(walletToggleIconFrames(-0.2)).toEqual(walletToggleIconFrames(0));
    expect(walletToggleIconFrames(1.3)).toEqual(walletToggleIconFrames(1));
  });
});

describe("accountWalletChrome (H28)", () => {
  it("puts the button below the status bar and the wallet content below the button", () => {
    expect(accountWalletChrome(59, "ios")).toEqual({ buttonTop: 67, walletContentTop: 52 });
    // Android has no automatic inset, so the wallet scroll adds the status bar.
    expect(accountWalletChrome(24, "android")).toEqual({ buttonTop: 32, walletContentTop: 76 });
  });
});
