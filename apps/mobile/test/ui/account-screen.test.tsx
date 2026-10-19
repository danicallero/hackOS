import { CAPABILITIES } from "@hackos/shared/capabilities";
import { act, fireEvent, screen, userEvent, waitFor, within } from "@testing-library/react-native";
import { Alert, BackHandler, ScrollView } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

const testMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockSetParams = jest.fn();
let mockSearchParams: Record<string, string | undefined> = {};
const mockFocusEffect = jest.fn();
const mockApiFetch = jest.fn();
const mockDeleteOwnAccount = jest.fn();
const mockRequestAccountRemovalPin = jest.fn();
const mockFetchAccountRemovalEligibility = jest.fn();
const mockMeContext = {
  me: {
    id: 1,
    email: "person@example.com",
    emailVerified: true,
    name: "Ada",
    surname: "Lovelace",
    image: null,
    dni: null,
    badgeId: null,
    language: "en",
    foodIntolerances: [],
    foodIntoleranceNotes: null,
    shirtSize: null,
    universityId: null,
    notes: null,
    accountState: "active" as const,
    removal: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    visibleRoleName: "participant" as const,
    hasEventAccess: true,
    hasQueueItems: false,
    capabilities: [] as string[],
  },
  loading: false,
  error: null,
  refetch: jest.fn().mockResolvedValue(undefined),
};

jest.mock("@expo/ui/community/menu", () => {
  return { MenuView: ({ children }: { children: unknown }) => children };
});
jest.mock("expo-router", () => ({
  useNavigation: () => ({ setOptions: jest.fn() }),
  useFocusEffect: (callback: () => void) => {
    mockFocusEffect(callback);
    const ReactLib = require("react");
    ReactLib.useEffect(callback, []);
  },
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: mockPush, replace: mockReplace, setParams: mockSetParams }),
  useScrollToTop: jest.fn(),
}));
jest.mock("expo-router/stack", () => ({ Stack: { Screen: () => null } }));
jest.mock("@/components/native-ui", () => {
  const ReactLib = require("react");
  const Native = require("react-native");
  return {
    ActionButton: ({
      busy,
      disabled,
      label,
      onPress,
    }: {
      busy?: boolean;
      disabled?: boolean;
      label: string;
      onPress: () => void;
    }) =>
      ReactLib.createElement(
        Native.Pressable,
        {
          accessibilityLabel: label,
          accessibilityRole: "button",
          accessibilityState: { busy, disabled: busy || disabled },
          disabled: busy || disabled,
          onPress,
        },
        ReactLib.createElement(Native.Text, null, label),
      ),
    AndroidStatusBarScrim: () => null,
    InfoRow: ({ label, value }: { label: string; value: string }) =>
      ReactLib.createElement(
        Native.View,
        null,
        ReactLib.createElement(Native.Text, null, label),
        ReactLib.createElement(Native.Text, null, value),
      ),
    Section: ({ title, children }: { title?: string; children: unknown }) =>
      ReactLib.createElement(
        Native.View,
        null,
        title ? ReactLib.createElement(Native.Text, null, title) : null,
        children,
      ),
    Separator: () => ReactLib.createElement(Native.View),
    StatusPill: ({ children }: { children: unknown }) =>
      ReactLib.createElement(Native.Text, null, children),
  };
});
jest.mock("@/components/RequestFeedback", () => {
  const ReactLib = require("react");
  const Native = require("react-native");
  return {
    RequestFeedback: ({
      error,
      loading,
      message,
      onRetry,
    }: {
      error?: Error | null;
      loading?: boolean;
      message?: string;
      onRetry?: () => void;
    }) =>
      loading
        ? ReactLib.createElement(Native.Text, null, "Loading")
        : error
          ? ReactLib.createElement(
              Native.View,
              { accessibilityRole: "alert" },
              ReactLib.createElement(Native.Text, null, message ?? error.message),
              onRetry
                ? ReactLib.createElement(
                    Native.Pressable,
                    { accessibilityRole: "button", accessibilityLabel: "Retry", onPress: onRetry },
                    ReactLib.createElement(Native.Text, null, "Retry"),
                  )
                : null,
            )
          : null,
  };
});
jest.mock("@/lib/api", () => {
  class MockApiError extends Error {
    status: number;
    code?: string;
    details?: unknown;

    constructor(message: string, status: number, code?: string, details?: unknown) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }
  return { ApiError: MockApiError, apiFetch: (...args: unknown[]) => mockApiFetch(...args) };
});
jest.mock("@/lib/auth-client", () => ({
  forceLocalSignOut: jest.fn(),
  signOut: jest.fn().mockResolvedValue({ error: null }),
}));
jest.mock("@/lib/env", () => ({ EVENT_WEBSITE_URL: "https://event.example" }));
jest.mock("@/lib/haptics", () => ({ haptic: jest.fn() }));
jest.mock("@/lib/i18n", () => {
  const translate = (key: string, values?: Record<string, string>) =>
    ({
      accountAccredited: "Accredited",
      accountContact: "Contact",
      accountDeleteSection: "Delete account",
      accountDeleteIntro:
        "Deleting your hackOS account is permanent. Your personal information will be removed from hackOS.",
      accountDeleteOutcomeTitle: "Deletion outcome",
      accountDeleteFullOutcomeTitle: "Full account deletion",
      accountDeleteFullOutcomeDescription:
        "Your account, identity, and personal information will be removed from hackOS.",
      accountDeleteAnonymizedOutcomeTitle: "Account closure with anonymization",
      accountDeleteAnonymizedOutcomeDescription:
        "Your account and identity will be removed, while anonymous HackUDC audit data may remain for event auditing without a link to you.",
      accountDeleteWhatHappens: "What happens when you delete your account",
      accountDeleteIdentityConsequence: "Your account and identity are removed from hackOS.",
      accountDeleteParticipationConsequence:
        "If you're participating in HackUDC, your participation ends immediately.",
      accountDeleteDocumentationConsequence:
        "GPUL won't be able to issue participation or ECTS documentation linked to you afterward.",
      accountDeleteAnonymousDataTitle: "Anonymous event data",
      accountDeleteAnonymousDataDescription:
        "GPUL may keep anonymous attendance and demographic data required for HackUDC event auditing. This data will no longer be linked to your identity.",
      accountDeleteRetainedDisclosure: "See what data may be retained",
      accountDeleteRetainedDisclosureHide: "Hide retained data",
      accountDeleteVenueExitWarning:
        "You're recorded as inside the HackUDC venue. GPUL event staff must record your exit before hackOS can finish deleting your account.",
      accountDeleteIntegrityWarning:
        "Some HackUDC operational records aren't linked to a canonical accreditation. GPUL event staff may need to reconcile them before hackOS can finish deleting your account.",
      accountDeleteContinue: "Continue to delete account",
      accountDeleteAction: "Delete my account",
      accountDeleteConfirmTitle: "Confirm account deletion",
      accountDeleteVerificationBody:
        "We've sent a 6-digit verification code to your verified email. Enter it below to confirm that you want to permanently delete your account.",
      accountDeleteNoVerificationBody:
        "Your account is ready to be deleted. Confirm below to continue.",
      accountDeleteVerificationCodeLabel: "Security code",
      accountDeleteResendCode: "Resend code",
      accountDeleteResendIn: `Resend code in ${values?.seconds ?? ""}s`,
      accountDeleteWarning:
        "This can't be undone. If you're participating in HackUDC, deleting your account will also end your participation.",
      accountRetainedAge: "Age",
      accountRetainedGender: "Gender",
      accountRetainedUniversity: "University",
      accountRetainedDegree: "Degree",
      accountRetainedGraduationYear: "Graduation year",
      accountRetainedOriginCity: "Origin city",
      accountRetainedPresenceTime: "Verified venue-presence time",
      accountEventDetails: "Event details",
      accountStaff: "Staff",
      accountStatistics: "Statistics",
      accountApp: "App",
      accountAccount: "Account",
      statisticsStaffOnly: "Statistics are available to staff accounts only.",
      accountFoodIntolerances: "Food intolerances",
      accountNetworkingProfile: "Edit networking profile",
      accountLegalTitle: "Legal",
      accountLanguage: "Language",
      accountName: "Name",
      accountNoneDeclared: "None declared",
      accountNotAccredited: "Accreditation pending",
      accountNotSet: "Not set",
      accountPrivacyPolicy: "Privacy policy",
      accountRemovalLoadError: "Couldn't load the account-deletion options.",
      accountRemovalPinExpired: "This security code expired.",
      accountRemovalPinInvalid: "Enter the 6-digit security code.",
      accountRemovalPinRequestError: "We couldn't send a security code. Try again.",
      accountRemovalPinRequired: "Request a new security code.",
      accountRemovalPinStaticDescription: "Test verification code",
      accountRemovalPasswordDescription:
        "Enter your current password to confirm that you want to permanently delete your account.",
      accountRemovalPasswordInvalid: "The current password is incorrect.",
      accountRemovalPasswordLabel: "Current password",
      accountRemovalPasswordRequired: "Enter your current password.",
      accountRemovalPending: "Your account deletion request was accepted.",
      accountRemovalPendingTitle: "Exit needed to finish account deletion",
      accountRemovalPendingExit:
        "Your account deletion request was accepted, but you must leave the HackUDC venue.",
      accountShirtSize: "Shirt size",
      accountTerms: "Terms and conditions",
      cancel: "Cancel",
      confirm: "Confirm",
      roleParticipant: "Participant",
      sessionActive: `Signed in as ${values?.email ?? ""}`,
      sessionTitle: "Session",
      signOut: "Sign out",
      signOutError: "Couldn't sign out.",
      signOutConfirmBody: "Sign out of this device?",
      signOutConfirmTitle: "Sign out",
      backToSignIn: "Back to sign in",
      storageTitle: "Storage",
      storageDataTitle: "App storage",
      tabWallet: "Wallet",
      close: "Close",
    })[key] ?? key;
  return { useLocale: () => ({ language: "en", t: translate }) };
});
jest.mock("@/components/wallet-screen", () => {
  const ReactLib = require("react");
  const Native = require("react-native");
  return ({ contentTopInset }: { contentTopInset: number }) =>
    ReactLib.createElement(Native.Text, { testID: "wallet-screen" }, String(contentTopInset));
});
jest.mock("@/lib/me-context", () => ({ useMeContext: () => mockMeContext }));
jest.mock("@/lib/removal-progress", () => ({
  clearAccountRemovalProgress: jest.fn().mockResolvedValue(undefined),
  saveAccountRemovalProgress: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/router-tabs-inset", () => ({
  useRouterTabBarBottomInset: () => 0,
  useRouterTabBarScrollBottomInset: () => 0,
}));
jest.mock("@/lib/self-service", () => ({
  anonymizeOwnAccount: jest.fn(),
  deleteOwnAccount: (...args: unknown[]) => mockDeleteOwnAccount(...args),
  fetchAccountRemovalEligibility: (...args: unknown[]) =>
    mockFetchAccountRemovalEligibility(...args),
  requestAccountRemovalPin: (...args: unknown[]) => mockRequestAccountRemovalPin(...args),
}));
jest.mock("@/lib/scanner-db", () => ({
  wipeAttendanceRoster: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/storage-usage", () => ({ clearAccountData: jest.fn() }));
jest.mock("@/lib/use-android-top-inset", () => ({ useAndroidTopInset: () => 0 }));
jest.mock("@/theme/colors", () => ({
  colors: {
    accent: "#007aff",
    accentText: "#ffffff",
    background: "#f5f5f7",
    destructive: "#d70015",
    destructiveSurface: "#fff0f0",
    elevatedSurface: "#eeeeee",
    label: "#171717",
    onDestructiveSurface: "#d70015",
    secondaryLabel: "#5f6368",
    separator: "#d1d1d6",
    success: "#248a3d",
    tertiaryLabel: "#8e8e93",
    warning: "#c25d00",
  },
}));

import AccountScreen from "@/components/account-screen";
import DeleteAccountScreen from "@/components/delete-account-screen";
import { ApiError } from "@/lib/api";
import { forceLocalSignOut, signOut } from "@/lib/auth-client";
import { renderMobile } from "./render";

describe("account removal UI flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMeContext.me.capabilities = [];
    mockSearchParams = {};
    mockApiFetch.mockResolvedValue({ intolerances: [] });
    mockFetchAccountRemovalEligibility.mockResolvedValue({
      action: "delete",
      reasonCode: "fresh_account",
      accessRevoked: true,
      operationalHistoryRetained: false,
      activeEventConsequences: false,
      requiresVenueExit: false,
      integrityWarning: false,
      securityPinRequired: true,
      reauthenticationRequired: false,
    });
    mockRequestAccountRemovalPin.mockResolvedValue({
      status: "sent",
      expiresAt: new Date(Date.now() + 10 * 60 * 1_000).toISOString(),
    });
  });

  it("keeps deletion to two screens and shows verification errors inline", async () => {
    const user = userEvent.setup();
    await renderMobile(<DeleteAccountScreen />);

    await waitFor(() => expect(mockFetchAccountRemovalEligibility).toHaveBeenCalledTimes(1));
    expect(
      screen.getByText(
        "Deleting your hackOS account is permanent. Your personal information will be removed from hackOS.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("What happens when you delete your account")).toBeTruthy();
    expect(screen.getByText("Full account deletion")).toBeTruthy();
    expect(screen.queryByText(/Step \d of \d/)).toBeNull();

    await user.press(screen.getByRole("button", { name: "See what data may be retained" }));
    expect(screen.getByText("Age")).toBeTruthy();
    expect(screen.getByText("Verified venue-presence time")).toBeTruthy();

    await user.press(screen.getByRole("button", { name: "Continue to delete account" }));
    await waitFor(() => expect(mockRequestAccountRemovalPin).toHaveBeenCalledTimes(1));
    expect(
      screen.getByText(
        "We've sent a 6-digit verification code to your verified email. Enter it below to confirm that you want to permanently delete your account.",
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText("Security code")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Resend code in/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();

    mockDeleteOwnAccount.mockRejectedValueOnce(
      new ApiError("The verification code is incorrect.", 400, "removal_pin_invalid"),
    );
    await user.type(screen.getByLabelText("Security code"), "123456");
    await user.press(screen.getByRole("button", { name: "Delete my account" }));

    await waitFor(() => expect(screen.getByText("Enter the 6-digit security code.")).toBeTruthy());
    expect(screen.getByLabelText("Security code")).toBeTruthy();

    await act(async () => {
      (mockFocusEffect.mock.calls[0]?.[0] as (() => void) | undefined)?.();
    });
    expect(
      screen.getByText(
        "Deleting your hackOS account is permanent. Your personal information will be removed from hackOS.",
      ),
    ).toBeTruthy();
    await user.press(screen.getByRole("button", { name: "Continue to delete account" }));
    await waitFor(() => expect(mockRequestAccountRemovalPin).toHaveBeenCalledTimes(2));
  });

  it("keeps secondary actions compact and refreshes from pull-to-refresh", async () => {
    const user = userEvent.setup();
    await renderMobile(<AccountScreen />);

    expect(screen.getByText("App")).toBeTruthy();
    expect(screen.getByText("Account")).toBeTruthy();
    expect(screen.getByText("Legal")).toBeTruthy();
    expect(screen.getByText("Shirt size")).toBeTruthy();
    expect(screen.queryByText("Staff")).toBeNull();
    expect(screen.getByRole("button", { name: "Storage" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete account" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();

    const scroll = screen.getByTestId("account-scroll");
    await act(async () => {
      scroll.props.refreshControl.props.onRefresh();
    });
    await waitFor(() => expect(mockMeContext.refetch).toHaveBeenCalledTimes(1));

    // #934, #935: always available, whatever the event window.
    await user.press(screen.getByRole("button", { name: "Edit networking profile" }));
    expect(mockPush).toHaveBeenCalledWith("/networking-profile");

    await user.press(screen.getByRole("button", { name: "Storage" }));
    expect(mockPush).toHaveBeenCalledWith("/(tabs)/others/storage");
    await user.press(screen.getByRole("button", { name: "Legal" }));
    expect(mockPush).toHaveBeenCalledWith("/(tabs)/others/legal");
    await user.press(screen.getByRole("button", { name: "Delete account" }));
    expect(mockPush).toHaveBeenCalledWith("/(tabs)/others/delete-account");
  });

  it("opens the wallet from the header button, which becomes its close button (H28)", async () => {
    const user = userEvent.setup();
    await renderMobile(<AccountScreen />);

    expect(screen.queryByText("View tickets")).toBeNull();
    expect(screen.queryByTestId("wallet-screen")).toBeNull();

    await user.press(screen.getByRole("button", { name: "Wallet" }));
    // Below the 44 pt button and its 8 pt gap; iOS adds the status bar itself.
    expect(screen.getByTestId("wallet-screen")).toHaveTextContent("52");
    const close = screen.getByRole("button", { name: "Close" });
    expect(close).toBe(screen.getByTestId("account-wallet-close"));
    expect(close.props.accessibilityState).toEqual({ expanded: true });
    expect(mockPush).not.toHaveBeenCalled();

    await user.press(close);
    await waitFor(() => expect(screen.queryByTestId("wallet-screen")).toBeNull());
    expect(screen.getByRole("button", { name: "Wallet" })).toBeTruthy();
  });

  it("keeps the wallet button in the scrolling content, not pinned (H28)", async () => {
    await renderMobile(<AccountScreen />);
    const scroll = screen.getByTestId("account-scroll");
    expect(within(scroll).getByTestId("account-wallet-button")).toBeTruthy();
  });

  it("closes the wallet on Android system back before leaving Account (H28)", async () => {
    const backHandler = jest.spyOn(BackHandler, "addEventListener");
    const user = userEvent.setup();
    await renderMobile(<AccountScreen />);
    expect(backHandler).not.toHaveBeenCalled();

    await user.press(screen.getByRole("button", { name: "Wallet" }));
    const onBack = backHandler.mock.calls.at(-1)?.[1] as () => boolean;
    let handled = false;
    await act(async () => {
      handled = onBack();
    });
    expect(handled).toBe(true);
    await waitFor(() => expect(screen.queryByTestId("wallet-screen")).toBeNull());
    backHandler.mockRestore();
  });

  it("consumes the alerts highlight param once: scroll to Notifications, flash, clear", async () => {
    // The jest ScrollView has no native view behind it; observe its ref method.
    jest.useFakeTimers();
    const scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo").mockImplementation(() => {});
    mockSearchParams = { highlight: "notifications", highlightAt: "1" };
    await renderMobile(<AccountScreen />);
    const scroll = screen.getByTestId("account-scroll");

    await act(async () => {
      fireEvent(scroll, "layout", { nativeEvent: { layout: { height: 600 } } });
      fireEvent(screen.getByTestId("account-notifications"), "layout", {
        nativeEvent: { layout: { y: 900 } },
      });
    });

    expect(mockSetParams).toHaveBeenCalledTimes(1);
    expect(mockSetParams).toHaveBeenCalledWith({
      highlight: undefined,
      highlightAt: undefined,
    });
    // Account jumps to the top first; no animated scroll before the transition settles.
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenLastCalledWith({ animated: false, y: 0 });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenLastCalledWith({ animated: true, y: 700 });
    expect(screen.getByTestId("account-notifications-highlight")).toBeTruthy();

    // Later layout passes before the router drops the param must not replay it.
    await act(async () => {
      fireEvent(scroll, "layout", { nativeEvent: { layout: { height: 640 } } });
      fireEvent(screen.getByTestId("account-notifications"), "layout", {
        nativeEvent: { layout: { y: 920 } },
      });
    });
    expect(mockSetParams).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(scrollTo).toHaveBeenCalledTimes(2);
    scrollTo.mockRestore();
    jest.useRealTimers();
  });

  it("starts the highlight scroll and tab re-press from the true top under an automatic inset", async () => {
    jest.useFakeTimers();
    const scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo").mockImplementation(() => {});
    // iOS reports the large-title inset as a negative resting offset; the
    // jest ScrollView emits no UI-thread scroll events to capture it from.
    const collapse = require("@/components/profile-avatar-collapse");
    const realHook = collapse.useProfileAvatarCollapse;
    const hook = jest
      .spyOn(collapse, "useProfileAvatarCollapse")
      .mockImplementation((...args: unknown[]) => {
        const controller = realHook(...args);
        controller.restingOffset.value = -150;
        return controller;
      });
    mockSearchParams = { highlight: "notifications", highlightAt: "1" };
    await renderMobile(<AccountScreen />);
    const scroll = screen.getByTestId("account-scroll");

    await act(async () => {
      fireEvent(scroll, "layout", { nativeEvent: { layout: { height: 600 } } });
      fireEvent(screen.getByTestId("account-notifications"), "layout", {
        nativeEvent: { layout: { y: 900 } },
      });
    });

    expect(scrollTo).toHaveBeenLastCalledWith({ animated: false, y: -150 });
    // Without it iOS clamps a negative target to the raw inset, i.e. y 0.
    expect(scroll.props.scrollToOverflowEnabled).toBe(true);
    // Tab re-press scrolls to the same true top, not y 0.
    const { useScrollToTop } = require("expo-router");
    const topRef = (useScrollToTop as jest.Mock).mock.calls.at(-1)[0];
    topRef.current.scrollToTop();
    expect(scrollTo).toHaveBeenLastCalledWith({ animated: true, y: -150 });
    hook.mockRestore();
    scrollTo.mockRestore();
    jest.useRealTimers();
  });

  it("replays the scroll from the top on every gear tap (new nonce)", async () => {
    jest.useFakeTimers();
    const scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo").mockImplementation(() => {});
    mockSearchParams = { highlight: "notifications", highlightAt: "1" };
    const view = await renderMobile(<AccountScreen />);
    await act(async () => {
      fireEvent(screen.getByTestId("account-scroll"), "layout", {
        nativeEvent: { layout: { height: 600 } },
      });
      fireEvent(screen.getByTestId("account-notifications"), "layout", {
        nativeEvent: { layout: { y: 900 } },
      });
    });
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(scrollTo).toHaveBeenCalledTimes(2);

    // The router cleared the params; a later tap arrives with a fresh nonce.
    const rerender = () =>
      view.rerender(
        <GestureHandlerRootView>
          <SafeAreaProvider initialMetrics={testMetrics}>
            <AccountScreen />
          </SafeAreaProvider>
        </GestureHandlerRootView>,
      );
    mockSearchParams = {};
    await act(async () => rerender());
    mockSearchParams = { highlight: "notifications", highlightAt: "2" };
    scrollTo.mockClear();
    await act(async () => rerender());
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenLastCalledWith({ animated: false, y: 0 });
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenLastCalledWith({ animated: true, y: 700 });
    expect(mockSetParams).toHaveBeenCalledTimes(2);
    scrollTo.mockRestore();
    jest.useRealTimers();
  });

  it("leaves scroll position alone without a highlight param", async () => {
    await renderMobile(<AccountScreen />);
    await act(async () => {
      fireEvent(screen.getByTestId("account-notifications"), "layout", {
        nativeEvent: { layout: { y: 900 } },
      });
    });
    expect(mockSetParams).not.toHaveBeenCalled();
  });

  it("shows Statistics only with staff statistics access", async () => {
    const user = userEvent.setup();
    mockMeContext.me.capabilities = [CAPABILITIES.LOGISTICS_STATS];
    await renderMobile(<AccountScreen />);

    expect(screen.getByText("Staff")).toBeTruthy();
    await user.press(screen.getByRole("button", { name: "Statistics" }));
    expect(mockPush).toHaveBeenCalledWith("/(tabs)/others/statistics");
  });

  it("offers a local route back to sign in when sign-out fails", async () => {
    const user = userEvent.setup();
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    (signOut as jest.Mock).mockRejectedValueOnce(new Error("offline"));
    await renderMobile(<AccountScreen />);

    await user.press(screen.getByRole("button", { name: "Sign out" }));
    const actions = alert.mock.calls[0]?.[2] as
      | Array<{ text: string; onPress?: () => void }>
      | undefined;
    actions?.find((action) => action.text === "Sign out")?.onPress?.();

    await waitFor(() => expect(screen.getByRole("link", { name: "Back to sign in" })).toBeTruthy());
    await user.press(screen.getByRole("link", { name: "Back to sign in" }));

    expect(forceLocalSignOut).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith("/(auth)/sign-in");
    alert.mockRestore();
  });
});
