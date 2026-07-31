import { UI_TEST_IDS } from "@hackos/shared/ui-test-ids";
import { screen, userEvent, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/auth-client", () => ({
  signIn: { email: jest.fn() },
  signOut: jest.fn(),
}));
jest.mock("@/lib/env", () => ({ EVENT_WEBSITE_DISPLAY: "event.example" }));
jest.mock("@/theme/colors", () => ({
  colors: {
    accent: "#007aff",
    accentText: "#ffffff",
    background: "#f5f5f7",
    destructive: "#d70015",
    destructiveSurface: "#fff0f0",
    label: "#171717",
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
        eventAccessNotice: "Event access",
        eventCompanionSubtitle: "Event companion",
        forgotPassword: "Forgot password?",
        mobileAccessDenied: "Mobile access denied",
        passwordLabel: "Password",
        passwordPlaceholder: "Password",
        signInButton: "Sign in",
        signInError: "Could not sign in",
      })[key] ?? key,
  }),
}));

import SignInScreen from "@/app/(auth)/sign-in";
import { apiFetch } from "@/lib/api";
import { signIn } from "@/lib/auth-client";
import { renderMobile } from "./render";

const mockApiFetch = apiFetch as jest.Mock;
const mockSignInEmail = signIn.email as jest.Mock;

describe("native sign-in UI contract", () => {
  beforeEach(() => {
    mockApiFetch.mockReset().mockRejectedValue(new Error("offline"));
    mockSignInEmail.mockReset().mockResolvedValue({ error: null });
  });

  it("exposes the shared controls and enables submit after credentials are entered", async () => {
    const user = userEvent.setup();
    await renderMobile(<SignInScreen />);

    const email = screen.getByTestId(UI_TEST_IDS.auth.email);
    const password = screen.getByTestId(UI_TEST_IDS.auth.password);
    const submit = screen.getByTestId(UI_TEST_IDS.auth.submit);

    expect(email).toBeTruthy();
    expect(password).toBeTruthy();
    expect(submit).toBeDisabled();

    await user.type(email, "person@example.com");
    await user.type(password, "secret");

    expect(submit).toBeEnabled();
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
