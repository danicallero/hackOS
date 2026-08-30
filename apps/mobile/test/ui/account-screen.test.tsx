import { CAPABILITIES } from "@hackos/shared/capabilities";
import { act, screen, userEvent, waitFor } from "@testing-library/react-native";

const mockPush = jest.fn();
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
    secondaryEmail: null,
    secondaryEmailVerified: false,
    foodIntolerances: [],
    foodIntoleranceNotes: null,
    shirtSize: null,
    universityId: null,
    notes: null,
    accountState: "active" as const,
    removal: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    role: "participant" as const,
    mobileAccess: true,
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
  useFocusEffect: (callback: () => void) => {
    mockFocusEffect(callback);
    const ReactLib = require("react");
    ReactLib.useEffect(callback, []);
  },
  useRouter: () => ({ push: mockPush }),
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
jest.mock("@/lib/auth-client", () => ({ signOut: jest.fn().mockResolvedValue({ error: null }) }));
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
      accountSecondaryEmail: "Secondary email",
      accountFoodIntolerances: "Food intolerances",
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
      signOutConfirmBody: "Sign out of this device?",
      signOutConfirmTitle: "Sign out",
      storageTitle: "Storage",
      storageDataTitle: "App storage",
    })[key] ?? key;
  return { useLocale: () => ({ language: "en", t: translate }) };
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
import { renderMobile } from "./render";

describe("account removal UI flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMeContext.me.capabilities = [];
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
    expect(screen.getByText("Secondary email")).toBeTruthy();
    expect(screen.queryByText("Staff")).toBeNull();
    expect(screen.getByRole("button", { name: "Storage" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete account" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();

    const scroll = screen.getByTestId("account-scroll");
    await act(async () => {
      scroll.props.refreshControl.props.onRefresh();
    });
    await waitFor(() => expect(mockMeContext.refetch).toHaveBeenCalledTimes(1));

    await user.press(screen.getByRole("button", { name: "Storage" }));
    expect(mockPush).toHaveBeenCalledWith("/(tabs)/others/storage");
    await user.press(screen.getByRole("button", { name: "Legal" }));
    expect(mockPush).toHaveBeenCalledWith("/(tabs)/others/legal");
    await user.press(screen.getByRole("button", { name: "Delete account" }));
    expect(mockPush).toHaveBeenCalledWith("/(tabs)/others/delete-account");
  });

  it("shows Statistics only with staff statistics access", async () => {
    const user = userEvent.setup();
    mockMeContext.me.capabilities = [CAPABILITIES.LOGISTICS_STATS];
    await renderMobile(<AccountScreen />);

    expect(screen.getByText("Staff")).toBeTruthy();
    await user.press(screen.getByRole("button", { name: "Statistics" }));
    expect(mockPush).toHaveBeenCalledWith("/(tabs)/others/statistics");
  });
});
