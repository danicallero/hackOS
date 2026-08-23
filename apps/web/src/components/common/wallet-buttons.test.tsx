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
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

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
