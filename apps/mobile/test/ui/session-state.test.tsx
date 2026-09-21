import { act, fireEvent, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mockReplace = jest.fn();

jest.mock("expo-router", () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock("@/components/auth-ui", () => {
  const ReactLib = require("react");
  const Native = require("react-native");
  return {
    AuthButton: ({ label, onPress }: { label: string; onPress: () => void }) =>
      ReactLib.createElement(
        Native.Pressable,
        { accessibilityLabel: label, accessibilityRole: "button", onPress },
        ReactLib.createElement(Native.Text, null, label),
      ),
    AuthHeader: ({ title, description }: { title: string; description: string }) =>
      ReactLib.createElement(
        Native.View,
        null,
        ReactLib.createElement(Native.Text, null, title),
        ReactLib.createElement(Native.Text, null, description),
      ),
    AuthScreen: ({ children }: { children: ReactNode }) =>
      ReactLib.createElement(Native.View, { testID: "session-state" }, children),
  };
});
jest.mock("@/lib/auth-client", () => ({
  forceLocalSignOut: jest.fn(),
}));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string) =>
      ({
        backToSignIn: "Back to sign in",
        continueOffline: "Continue offline",
        retry: "Retry",
        sessionRecoveryDescription: "Check your connection and try again.",
        sessionRecoveryTitle: "Session unavailable",
        sessionRestoringDescription: "Restoring your session.",
        sessionRestoringTitle: "Restoring session",
      })[key] ?? key,
  }),
}));
jest.mock("@/theme/colors", () => ({
  colors: {
    interactiveText: "#0057b8",
    label: "#171717",
    secondaryLabel: "#5f6368",
  },
}));

import { SessionState } from "@/components/session-state";
import { forceLocalSignOut } from "@/lib/auth-client";
import { renderMobile } from "./render";

describe("session recovery sign-out fallback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("offers one local escape to sign in when session restoration fails", async () => {
    await renderMobile(<SessionState loading={false} onRetry={jest.fn()} />);

    expect(screen.getByRole("link", { name: "Back to sign in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
    fireEvent.press(screen.getByRole("link", { name: "Back to sign in" }));

    expect(forceLocalSignOut).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/(auth)/sign-in");
  });

  it("offers offline entry only after the recovery grace period", async () => {
    jest.useFakeTimers();
    const onContinueOffline = jest.fn();
    await renderMobile(
      <SessionState
        loading
        offlineAvailable
        onContinueOffline={onContinueOffline}
        onRetry={jest.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Continue offline" })).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(2_000);
    });
    fireEvent.press(screen.getByRole("button", { name: "Continue offline" }));
    expect(onContinueOffline).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });
});
