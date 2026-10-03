import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WalletButtons } from "./wallet-buttons";

vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({ language: "en", t: (key: string) => key }),
}));
vi.mock("@/lib/logistics", () => ({
  logisticsApi: { googleWalletSaveUrl: vi.fn() },
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn() } }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("WalletButtons", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("hands Apple Wallet the pass in the current browsing context", () => {
    act(() => root.render(<WalletButtons purpose="ticket" />));

    const link = container.querySelector<HTMLAnchorElement>(
      'a[href="http://localhost:3000/api/me/wallet/apple/ticket.pkpass"]',
    );
    expect(link).not.toBeNull();
    expect(link?.hasAttribute("target")).toBe(false);
    expect(link?.querySelector("img")?.getAttribute("alt")).toBe("addToAppleWallet");
  });
});

it("consumes a Google Wallet email action once and leaves the badges available after failure", async () => {
  const { logisticsApi } = await import("@/lib/logistics");
  const { toast } = await import("@/lib/toast");
  vi.mocked(logisticsApi.googleWalletSaveUrl).mockRejectedValueOnce(new Error("Unavailable"));
  window.history.replaceState(null, "", "/wallet?add=google");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<WalletButtons purpose="ticket" />);
    });
    expect(logisticsApi.googleWalletSaveUrl).toHaveBeenCalledWith("ticket");
    expect(window.location.search).toBe("");
    expect(toast.error).toHaveBeenCalledWith("walletGoogleSaveFailed", "toastWalletSettings");
    expect(container.querySelector("button img")?.getAttribute("src")).toBe(
      "/wallet-badges/google-wallet-button-en.svg",
    );
  } finally {
    act(() => root.unmount());
    container.remove();
    window.history.replaceState(null, "", "/");
    vi.clearAllMocks();
  }
});
