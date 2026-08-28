import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Alert } from "react-native";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

jest.mock("react-native", () => {
  const RN = jest.requireActual("react-native");
  return new Proxy(RN, {
    get: (target, prop, receiver) =>
      prop === "useWindowDimensions"
        ? () => ({ fontScale: 1.4, height: 844, scale: 1, width: 390 })
        : Reflect.get(target, prop, receiver),
  });
});

jest.mock("@/components/auth-ui", () => {
  const ReactLib = require("react");
  const Native = require("react-native");
  return {
    AuthAlert: ({ message }: { message: string }) =>
      ReactLib.createElement(Native.Text, { accessibilityRole: "alert" }, message),
    AuthButton: ({
      label,
      onPress,
      disabled,
      busy,
    }: {
      label: string;
      onPress: () => void;
      disabled?: boolean;
      busy?: boolean;
    }) =>
      ReactLib.createElement(
        Native.Pressable,
        {
          accessibilityLabel: label,
          accessibilityRole: "button",
          accessibilityState: { disabled: disabled || busy, busy },
          disabled: disabled || busy,
          onPress,
        },
        ReactLib.createElement(Native.Text, null, label),
      ),
    AuthHeader: ({ title, description }: { title: string; description: string }) =>
      ReactLib.createElement(
        Native.View,
        null,
        ReactLib.createElement(Native.Text, null, title),
        ReactLib.createElement(Native.Text, null, description),
      ),
    AuthScreen: ({ children, scrollable }: { children: ReactNode; scrollable?: boolean }) =>
      ReactLib.createElement(
        Native.View,
        { testID: scrollable ? "pending-removal-scrollable" : "pending-removal-fixed" },
        children,
      ),
  };
});
jest.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    code?: string;
  },
}));
jest.mock("@/lib/auth-client", () => ({
  signOut: jest.fn(),
}));
jest.mock("@/lib/env", () => ({ EVENT_WEBSITE_URL: "https://event.example" }));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string, values?: Record<string, string>) =>
      ({
        accountRemovalCancel: "Cancel anonymization",
        accountRemovalCancelBody: "Cancel body",
        accountRemovalCancelError: "Cancel error",
        accountRemovalCancelTitle: "Cancel anonymization?",
        accountRemovalExpiry: `Recovery window: ${values?.time ?? "unknown"}`,
        accountRemovalExpiryHint: "You can cancel before the timer expires.",
        accountRemovalExpiryLabel: "Recovery window",
        accountRemovalPendingBody: "Your participation has ended.",
        accountRemovalPendingDescription: "Ask staff to record your exit.",
        accountRemovalPendingTitle: "Exit needed to finish anonymization",
        accountRemovalProcessingBody: "Your account is being anonymized.",
        accountRemovalProcessingDescription: "Your request is being finalized.",
        accountRemovalProcessingTitle: "Finishing anonymization",
        accountRemovalExpiryUnknown: "Checking expiry…",
        accountRemovalRefreshError: "Couldn't refresh account-removal status.",
        accountPrivacyPolicy: "Privacy policy",
        close: "Close",
        keepAnonymization: "Keep anonymization",
        retry: "Retry",
        signOut: "Sign out",
        signOutError: "Couldn't sign out.",
      })[key] ?? key,
  }),
}));
jest.mock("@/lib/removal-progress", () => ({
  clearAccountRemovalProgress: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/self-service", () => ({
  cancelPendingAnonymization: jest.fn().mockResolvedValue({ status: "cancelled" }),
}));
jest.mock("@/theme/colors", () => ({
  colors: {
    background: "#f5f5f7",
    interactiveText: "#0057b8",
    label: "#171717",
    onDestructiveSurface: "#8b0000",
    primaryAction: "#0057b8",
    primaryActionText: "#ffffff",
    secondaryLabel: "#5f6368",
    separator: "#d1d1d6",
    surface: "#ffffff",
  },
}));

import { PendingRemovalScreen } from "@/components/pending-removal-screen";
import { signOut } from "@/lib/auth-client";
import { clearAccountRemovalProgress } from "@/lib/removal-progress";
import { cancelPendingAnonymization } from "@/lib/self-service";
import { renderMobile } from "./render";

describe("pending account-removal screen", () => {
  const removal = {
    status: "pending_exit" as const,
    action: "anonymize" as const,
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    canCancel: true as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (cancelPendingAnonymization as jest.Mock).mockResolvedValue({ status: "cancelled" });
    (signOut as jest.Mock).mockResolvedValue({ error: null });
  });

  it("keeps cancellation, expiry and sign-out visible while staff complete the exit", async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    await renderMobile(<PendingRemovalScreen removal={removal} onRefresh={refresh} />);

    expect(screen.getByText("Exit needed to finish anonymization")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Log your exit" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel anonymization" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeEnabled();
    expect(screen.getByText("Recovery window")).toBeTruthy();
    expect(screen.getByTestId("pending-removal-scrollable")).toBeTruthy();
  });

  it("cancels the pending request and refreshes the authoritative profile", async () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await renderMobile(<PendingRemovalScreen removal={removal} onRefresh={refresh} />);

    fireEvent.press(screen.getByRole("button", { name: "Cancel anonymization" }));
    const actions = alert.mock.calls[0]?.[2] as
      | Array<{ text: string; onPress?: () => void }>
      | undefined;
    const confirm = actions?.find((action) => action.text === "Cancel anonymization");
    confirm?.onPress?.();

    await waitFor(() => expect(cancelPendingAnonymization).toHaveBeenCalledTimes(1));
    expect(clearAccountRemovalProgress).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  it("signs out without requiring an exit scan from the device", async () => {
    await renderMobile(<PendingRemovalScreen removal={removal} onRefresh={jest.fn()} />);

    fireEvent.press(screen.getByText("Sign out"));

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it("keeps the screen visible and retries after a transient refresh failure", async () => {
    const refresh = jest.fn().mockRejectedValue(new Error("temporary outage"));
    await renderMobile(
      <PendingRemovalScreen
        removal={removal}
        onRefresh={refresh}
        refreshError={new Error("temporary outage")}
      />,
    );

    expect(
      screen
        .getAllByRole("alert")
        .some((alert) => alert.props.children === "Couldn't refresh account-removal status."),
    ).toBe(true);
    fireEvent.press(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(
      screen
        .getAllByRole("alert")
        .some((alert) => alert.props.children === "Couldn't refresh account-removal status."),
    ).toBe(true);
  });

  it("refreshes at recovery-window expiry and exposes a retry when that refresh fails", async () => {
    const refresh = jest.fn().mockRejectedValue(new Error("service unavailable"));
    await renderMobile(
      <PendingRemovalScreen
        removal={{ ...removal, expiresAt: new Date(Date.now() - 1_000).toISOString() }}
        onRefresh={refresh}
      />,
    );

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    expect(
      screen
        .getAllByRole("alert")
        .some((alert) => alert.props.children === "Couldn't refresh account-removal status."),
    ).toBe(true);
  });
});
