import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/common/alert-modal", () => ({
  AlertModal: ({
    open,
    cancelLabel,
    confirmLabel,
    onConfirm,
  }: {
    open?: boolean;
    cancelLabel: string;
    confirmLabel: string;
    onConfirm: () => void;
  }) =>
    open ? (
      <div role="dialog">
        <button type="button">{cancelLabel}</button>
        <button type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    ) : null,
}));
vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    code: string;

    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
  api: { post: vi.fn().mockResolvedValue({ status: "cancelled" }) },
}));
vi.mock("@/lib/auth-client", () => ({ signOut: vi.fn().mockResolvedValue({ error: null }) }));
vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string, values?: Record<string, string | number>) =>
      ({
        accountRemovalCancel: "Cancel anonymization",
        accountRemovalCancelBody: "You can cancel before the timer expires.",
        accountRemovalCancelError: "Cancel error",
        accountRemovalCancelTitle: "Cancel anonymization?",
        accountRemovalExpiryHint: "You can cancel before the timer expires.",
        accountRemovalExpiryLabel: "Recovery window",
        accountRemovalExpiryUnknown: "Checking expiry…",
        accountRemovalRefreshError: "Couldn't refresh account-removal status.",
        accountRemovalPendingBody: "Your participation has ended.",
        accountRemovalPendingDescription: "Ask event staff to record your exit.",
        accountRemovalPendingTitle: "Exit needed to finish anonymization",
        accountRemovalProcessingBody: "Your account is being anonymized.",
        accountRemovalProcessingDescription: "Your request is being finalized.",
        accountRemovalProcessingTitle: "Finishing anonymization",
        couldNotSignOut: "Could not sign out.",
        keepAnonymization: "Keep anonymization",
        privacyPolicy: "Privacy policy",
        signOut: "Sign out",
        retry: "Retry",
      })[key] ?? (key === "accountRemovalExpiry" ? `Recovery window: ${values?.time}` : key),
  }),
}));
vi.mock("@/lib/privacy-removal", () => ({ clearAccountRemovalProgress: vi.fn() }));

import { api } from "@/lib/api";
import { clearAccountRemovalProgress } from "@/lib/privacy-removal";
import { PendingRemovalScreen } from "./pending-removal-screen";

describe("PendingRemovalScreen", () => {
  let container: HTMLDivElement;
  let root: Root;
  const removal = {
    status: "pending_exit" as const,
    action: "anonymize" as const,
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    canCancel: true as const,
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.mocked(api.post).mockClear().mockResolvedValue({ status: "cancelled" });
    vi.mocked(clearAccountRemovalProgress).mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps cancellation, expiry and sign-out available while the pending exit is recoverable", () => {
    act(() => {
      root.render(<PendingRemovalScreen removal={removal} onRefresh={vi.fn()} />);
    });

    expect(container.textContent).toContain("Exit needed to finish anonymization");
    expect(container.textContent).not.toContain("Log your exit");
    expect(container.textContent).toContain("Cancel anonymization");
    expect(container.textContent).toContain("Recovery window");
    expect(container.textContent).toContain("Sign out");
  });

  it("cancels through the authenticated endpoint and refreshes the profile", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    act(() => {
      root.render(<PendingRemovalScreen removal={removal} onRefresh={refresh} />);
    });
    const user = userEvent.setup();

    const openCancel = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Cancel anonymization",
    );
    await act(async () => user.click(openCancel as HTMLButtonElement));
    const confirm = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Cancel anonymization" && button !== openCancel,
    );
    await act(async () => user.click(confirm as HTMLButtonElement));

    expect(api.post).toHaveBeenCalledWith("/api/me/anonymize/cancel", {});
    expect(clearAccountRemovalProgress).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the pending screen visible and offers retry after a transient refresh failure", async () => {
    const refresh = vi.fn().mockRejectedValue(new Error("temporary outage"));
    act(() => {
      root.render(
        <PendingRemovalScreen
          removal={removal}
          onRefresh={refresh}
          refreshError={new Error("temporary outage")}
        />,
      );
    });

    expect(container.textContent).toContain("Couldn't refresh account-removal status.");
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry",
    );
    await act(async () => userEvent.setup().click(retry as HTMLButtonElement));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Couldn't refresh account-removal status.");
  });
});
