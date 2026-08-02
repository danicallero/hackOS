import { UI_TEST_IDS } from "@hackos/shared/ui-test-ids";
import { fireEvent, screen, userEvent, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";

const mockSearchParams: { accessDenied?: string } = {};
const mockReplace = jest.fn();
const mockSetParams = jest.fn();

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, setParams: mockSetParams }),
}));

jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/auth-client", () => ({
  signIn: { email: jest.fn() },
  signOut: jest.fn(),
}));
jest.mock("@/components/auth-credential-field", () =>
  jest.requireActual("@/components/auth-credential-field.tsx"),
);
jest.mock("@/lib/env", () => ({
  EVENT_WEBSITE_DISPLAY: "event.example",
}));
jest.mock("@/theme/colors", () => ({
  colors: {
    accent: "#007aff",
    accentText: "#ffffff",
    background: "#f5f5f7",
    destructive: "#d70015",
    destructiveSurface: "#fff0f0",
    label: "#171717",
    interactiveText: "#0057b8",
    primaryAction: "#0057b8",
    primaryActionText: "#ffffff",
    secondaryLabel: "#5f6368",
    separator: "#d1d1d6",
    surface: "#ffffff",
    tertiaryLabel: "#7c7c80",
  },
}));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string) =>
      ({
        emailLabel: "Email",
        emailPlaceholder: "name@example.com",
        emailRequired: "Enter your email.",
        eventAccessTitle: "Need access?",
        eventAccessNotice: "Event access",
        eventCompanionSubtitle: "Event companion",
        forgotPassword: "Forgot password?",
        hidePassword: "Hide password",
        mobileAccessDenied: "Mobile access denied",
        mobileAccessDeniedTitle: "No access to the event app",
        passwordLabel: "Password",
        passwordPlaceholder: "Password",
        passwordRequired: "Enter your password.",
        showPassword: "Show password",
        signInButton: "Sign in",
        signInError: "Could not sign in",
        signInTitle: "Sign in",
        close: "Close",
      })[key] ?? key,
  }),
}));

import SignInScreen from "@/app/(auth)/sign-in";
import { apiFetch } from "@/lib/api";
import { signIn, signOut } from "@/lib/auth-client";
import { renderMobile } from "./render";

const mockApiFetch = apiFetch as jest.Mock;
const mockSignInEmail = signIn.email as jest.Mock;
const mockSignOut = signOut as jest.Mock;

describe("native sign-in UI contract", () => {
  beforeEach(() => {
    delete mockSearchParams.accessDenied;
    mockReplace.mockReset();
    mockSetParams.mockReset();
    mockApiFetch.mockReset().mockRejectedValue(new Error("offline"));
    mockSignInEmail.mockReset().mockResolvedValue({ error: null });
    mockSignOut.mockReset().mockResolvedValue({ error: null });
  });

  it("announces missing mobile access in a native modal", async () => {
    mockSearchParams.accessDenied = "1";
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});

    await renderMobile(<SignInScreen />);

    expect(mockSetParams).toHaveBeenCalledWith({ accessDenied: "" });
    expect(alert).toHaveBeenCalledWith("No access to the event app", "Mobile access denied", [
      { text: "Close" },
    ]);
    alert.mockRestore();
  });

  it("signs out and routes an authenticated account without mobile access to the modal", async () => {
    mockApiFetch
      .mockResolvedValueOnce({ name: "HackUDC 2026" })
      .mockResolvedValueOnce({ mobileAccess: false });
    const user = userEvent.setup();
    await renderMobile(<SignInScreen />);

    await user.type(screen.getByTestId(UI_TEST_IDS.auth.email), "person@example.com");
    await user.type(screen.getByTestId(UI_TEST_IDS.auth.password), "secret");
    await user.press(screen.getByTestId(UI_TEST_IDS.auth.submit));

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: "/(auth)/sign-in",
      params: { accessDenied: "1" },
    });
  });

  it("keeps submit discoverable and reports missing credentials beside the fields", async () => {
    const user = userEvent.setup();
    await renderMobile(<SignInScreen />);

    const email = screen.getByTestId(UI_TEST_IDS.auth.email);
    const password = screen.getByTestId(UI_TEST_IDS.auth.password);
    const submit = screen.getByTestId(UI_TEST_IDS.auth.submit);

    expect(email).toBeTruthy();
    expect(password).toBeTruthy();
    expect(submit).toBeEnabled();

    await user.press(submit);

    expect(screen.getByText("Enter your email.")).toHaveProp("accessibilityRole", "alert");
    expect(screen.getByText("Enter your password.")).toHaveProp("accessibilityRole", "alert");
    expect(email).toHaveProp("aria-invalid", true);
    expect(email).toHaveProp("accessibilityLabel", "Email");
    expect(email).toHaveProp("accessibilityHint", "Enter your email.");
    expect(password).toHaveProp("aria-invalid", true);

    await user.type(email, "person@example.com");
    await user.type(password, "secret");

    expect(submit).toBeEnabled();
    expect(email).toHaveProp("aria-invalid", false);
    expect(password).toHaveProp("aria-invalid", false);
  });

  it("uses the native credential pairing and exposes an accessible password visibility action", async () => {
    const user = userEvent.setup();
    await renderMobile(<SignInScreen />);

    const email = screen.getByTestId(UI_TEST_IDS.auth.email);
    const password = screen.getByTestId(UI_TEST_IDS.auth.password);
    expect(email).toHaveProp("autoComplete", "username");
    expect(password).toHaveProp("autoComplete", "current-password");
    expect(password).toHaveProp("secureTextEntry", true);
    expect(email.props.value).toBeUndefined();
    expect(password.props.value).toBeUndefined();

    // Opening a password-provider sheet temporarily blurs the native input.
    // The fields must stay uncontrolled so iOS can inject the selected pair.
    fireEvent(email, "blur");
    expect(screen.getByTestId(UI_TEST_IDS.auth.email).props.value).toBeUndefined();
    expect(screen.getByTestId(UI_TEST_IDS.auth.password).props.value).toBeUndefined();

    await user.press(screen.getByRole("button", { name: "Show password" }));

    expect(screen.getByTestId(UI_TEST_IDS.auth.password)).toHaveProp("secureTextEntry", false);
    expect(screen.getByRole("button", { name: "Hide password" })).toBeTruthy();
  });

  it("keeps a sign-in error accessible when the API rejects the request", async () => {
    mockSignInEmail.mockResolvedValue({ error: { status: 401 } });
    const user = userEvent.setup();
    await renderMobile(<SignInScreen />);

    await user.type(screen.getByTestId(UI_TEST_IDS.auth.email), "person@example.com");
    await user.type(screen.getByTestId(UI_TEST_IDS.auth.password), "secret");
    await user.press(screen.getByTestId(UI_TEST_IDS.auth.submit));

    await waitFor(() => expect(screen.getByTestId(UI_TEST_IDS.auth.error)).toBeTruthy());
    expect(screen.getByTestId(UI_TEST_IDS.auth.error)).toHaveProp("accessibilityRole", "alert");
  });
});
