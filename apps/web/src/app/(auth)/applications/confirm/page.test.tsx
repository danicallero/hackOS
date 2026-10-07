import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConfirmSpotPage from "./page";

const state = vi.hoisted(() => ({
  currentUserId: 42,
  push: vi.fn(),
  refresh: vi.fn(async () => {}),
  signOut: vi.fn(async () => ({ error: null })),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: state.push }),
  useSearchParams: () => new URLSearchParams("token=confirmation"),
}));
vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/session", () => ({
  useSessionContext: () => ({
    me: { id: state.currentUserId },
    status: "authenticated",
    refresh: state.refresh,
  }),
}));
vi.mock("@/lib/auth-client", () => ({ signOut: state.signOut }));
vi.mock("../lib", () => ({
  isConfirmExpiredError: () => false,
  useTokenAction: () => ({
    state: "done",
    result: {
      user_id: 42,
      status: "confirmed",
      already_confirmed: false,
      ticket_token: "door-code",
      holder_name: "Ada Lovelace",
      masked_email: "a***@example.org",
      wallet_token: "scoped-token",
      wallet_token_expires_at: "2026-10-07T18:00:00Z",
    },
    errorMsg: "",
    linkInvalid: false,
    retry: vi.fn(),
  }),
}));
vi.mock("@/components/common/qr-code", () => ({
  QrCode: () => <div data-testid="ticket-qr" />,
}));
vi.mock("@/components/common/wallet-buttons", () => ({
  WalletButtons: () => <div data-testid="wallet-buttons" />,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("acceptance confirmation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    state.currentUserId = 42;
    state.push.mockClear();
    state.refresh.mockClear();
    state.signOut.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps the holder signed in and opens the schedule", async () => {
    await act(async () => root.render(<ConfirmSpotPage />));
    expect(state.signOut).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Ada Lovelace");
    expect(container.querySelector('[data-testid="ticket-qr"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="wallet-buttons"]')).not.toBeNull();
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "goToApp")
        ?.click();
    });
    expect(state.push).toHaveBeenCalledWith("/schedule");
    expect(state.signOut).not.toHaveBeenCalled();
  });

  it("closes a different account's session", async () => {
    state.currentUserId = 7;
    await act(async () => root.render(<ConfirmSpotPage />));
    expect(state.signOut).toHaveBeenCalledOnce();
  });
});
