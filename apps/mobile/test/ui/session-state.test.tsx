import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mockReplace = jest.fn();

jest.mock("expo-router", () => ({ useRouter: () => ({ replace: mockReplace }) }));
jest.mock("@/components/auth-ui", () => {
  const ReactLib = require("react");
  const Native = require("react-native");
  return {
    AuthAlert: ({ message }: { message: string }) =>
      ReactLib.createElement(Native.Text, { accessibilityRole: "alert" }, message),
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
  signOut: jest.fn(),
}));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string) =>
      ({
        backToSignIn: "Back to sign in",
        retry: "Retry",
        sessionRecoveryDescription: "Check your connection and try again.",
        sessionRecoveryTitle: "Session unavailable",
        sessionRestoringDescription: "Restoring your session.",
        sessionRestoringTitle: "Restoring session",
        signOut: "Sign out",
        signOutError: "Couldn't sign out.",
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
import { forceLocalSignOut, signOut } from "@/lib/auth-client";
import { renderMobile } from "./render";

describe("session recovery sign-out fallback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (signOut as jest.Mock).mockRejectedValue(new Error("offline"));
  });

  it("can return to sign in when sign-out fails", async () => {
    await renderMobile(<SessionState loading={false} onRetry={jest.fn()} />);

    expect(screen.getByRole("link", { name: "Back to sign in" })).toBeTruthy();
    fireEvent.press(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(screen.getByRole("link", { name: "Back to sign in" })).toBeTruthy());
    fireEvent.press(screen.getByRole("link", { name: "Back to sign in" }));

    expect(forceLocalSignOut).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/(auth)/sign-in");
  });
});
