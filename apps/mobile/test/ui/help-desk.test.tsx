import mockhelpDeskEn from "@hackos/shared/locales/en/mobile.json";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import {
  Pressable as MockPressable,
  Text as MockText,
  TextInput as MockTextInput,
  View as MockView,
} from "react-native";
import { HelpRequestScreen } from "@/components/help-desk/request-screen";
import { NewHelpRequestScreen } from "@/components/help-desk/requests-screen";
import { ApiError } from "@/lib/api";
import type { HelpRequest } from "@/lib/help-desk";

const mockMutate = jest.fn();
const mockReplace = jest.fn();
const mockLoad = jest.fn();
const mockSetData = jest.fn();
let mockRequest: HelpRequest;
let mockCaps = ["helpdesk:request"];
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useLocalSearchParams: () => ({ id: "41" }),
}));
jest.mock("@/lib/use-help-draft-guard", () => ({ useHelpDraftGuard: jest.fn() }));
jest.mock("@/lib/me-context", () => ({
  useMeContext: () => ({ me: { id: 7, capabilities: mockCaps } }),
}));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string) =>
      ({ ...mockhelpDeskEn, cancel: "Cancel" })[key as keyof typeof mockhelpDeskEn] ?? key,
  }),
}));
jest.mock("@/lib/help-desk", () => ({
  ...jest.requireActual("@/lib/help-desk"),
  helpMutation: (...args: unknown[]) => mockMutate(...args),
}));
jest.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    details?: unknown;
    constructor(message: string, status: number, code?: string, details?: unknown) {
      super(message);
      this.status = status;
      this.code = code;
      this.details = details;
    }
  },
}));
jest.mock("@/components/RequestFeedback", () => ({
  RequestFeedback: ({ error }: { error?: Error }) =>
    error ? <MockText>{error.message}</MockText> : null,
}));
jest.mock("@/components/project-ui", () => ({ NavRow: () => null }));
jest.mock("@/theme", () => ({
  colors: new Proxy({}, { get: () => "#000" }),
  space: new Proxy({}, { get: () => 8 }),
  type: new Proxy({}, { get: () => ({}) }),
}));
jest.mock("@/components/person-avatar", () => ({ PersonAvatar: () => null }));
jest.mock("@/components/help-desk/rows", () => ({
  HELP_STATUS_KEYS: {
    open: "helpOpen",
    claimed: "helpClaimed",
    resolved: "helpResolved",
    cancelled: "helpCancelled",
  },
  HELP_STATUS_TONE: {
    open: "accent",
    claimed: "success",
    resolved: "neutral",
    cancelled: "warning",
  },
  RequestRow: () => null,
  HelperRow: () => null,
}));
jest.mock("@/components/segmented-control", () => ({
  SegmentedControl: ({
    values,
    onChange,
  }: {
    values: string[];
    onChange: (index: number) => void;
  }) => (
    <MockView>
      {values.map((value, index) => (
        <MockPressable
          key={value}
          accessibilityRole="tab"
          accessibilityLabel={value}
          onPress={() => onChange(index)}
        >
          <MockText>{value}</MockText>
        </MockPressable>
      ))}
    </MockView>
  ),
}));
jest.mock("@/components/native-ui", () => ({
  StatusPill: ({ children }: { children: React.ReactNode }) => <MockText>{children}</MockText>,
  InfoRow: ({ label, value }: { label: string; value: string }) => (
    <MockText>{`${label}: ${value}`}</MockText>
  ),
  Section: ({ children }: { children: React.ReactNode }) => <MockView>{children}</MockView>,
  Separator: () => null,
  ActionButton: ({
    label,
    onPress,
    disabled,
    busy,
  }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
    busy?: boolean;
  }) => (
    <MockPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled || busy}
      onPress={onPress}
    >
      <MockText>{label}</MockText>
    </MockPressable>
  ),
  ToggleRow: ({
    label,
    value,
    onChange,
    disabled,
  }: {
    label: string;
    value: boolean;
    onChange: (value: boolean) => void;
    disabled?: boolean;
  }) => (
    <MockPressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      disabled={disabled}
      onPress={() => onChange(!value)}
    >
      <MockText>{label}</MockText>
    </MockPressable>
  ),
}));
jest.mock("@/components/help-desk/primitives", () => ({
  HelpPage: ({
    children,
    action,
  }: {
    children: React.ReactNode;
    action?: { label: string; onPress: () => void; disabled?: boolean };
  }) => (
    <MockView>
      {action ? (
        <MockPressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          disabled={action.disabled}
          onPress={action.onPress}
        >
          <MockText>{action.label}</MockText>
        </MockPressable>
      ) : null}
      {children}
    </MockView>
  ),
  HelpText: ({ children }: { children: React.ReactNode }) => <MockText>{children}</MockText>,
  HelpInput: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
  }) => <MockTextInput accessibilityLabel={label} value={value} onChangeText={onChange} />,
  ChoiceRow: ({
    label,
    selected,
    onPress,
    disabled,
  }: {
    label: string;
    selected: boolean;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <MockPressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      disabled={disabled}
      onPress={onPress}
    >
      <MockText>{label}</MockText>
    </MockPressable>
  ),
  DetailRow: ({ children }: { children: React.ReactNode }) => <MockView>{children}</MockView>,
  TopicChips: ({ topics }: { topics: { name: string }[] }) => (
    <MockText>{topics.map((topic) => topic.name).join(", ")}</MockText>
  ),
  TopicField: () => null,
  useHelpResource: (path: string) => ({
    data:
      path === "/api/helpdesk/projects"
        ? { projects: [{ id: 9, name: "Team Nine" }] }
        : mockRequest,
    loading: false,
    error: null,
    load: mockLoad,
    setData: mockSetData,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockCaps = ["helpdesk:request"];
  mockRequest = {
    id: 41,
    status: "open",
    description: "Build fails",
    location: "Desk 5",
    topics: [{ id: 1, name: "Frontend" }],
    other: false,
    project: { id: 9, name: "Team Nine" },
    requester: { userId: 7, displayName: "Ada" },
    routing: "matched",
    notifiedCount: 2,
    claim: null,
    createdAt: "2027-02-20T09:00:00Z",
    resolvedAt: null,
    cancelledAt: null,
    viewer: {
      canCancel: false,
      canClaim: true,
      canRelease: false,
      canResolve: false,
      notified: true,
    },
  };
});
it("claims with the selected meeting location and blocks duplicate taps while pending (H66)", async () => {
  let finish!: (value: HelpRequest) => void;
  mockMutate.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render(<HelpRequestScreen />);
  await fireEvent.press(screen.getByLabelText("Come to this location"));
  await fireEvent.changeText(screen.getByLabelText("Meeting location"), "Sponsor stand");
  await fireEvent.press(screen.getByLabelText("Claim request"));
  await fireEvent.press(screen.getByLabelText("Claim request"));
  expect(mockMutate).toHaveBeenCalledTimes(1);
  expect(mockMutate).toHaveBeenCalledWith("/api/helpdesk/requests/41/claim", {
    mode: "meet_at",
    meetingLocation: "Sponsor stand",
  });
  await act(async () => finish(mockRequest));
  expect(mockSetData).toHaveBeenCalledWith(mockRequest);
});
it("refreshes after a competing claim and shows the localized conflict (H66)", async () => {
  mockMutate.mockRejectedValue(
    new ApiError("Conflict", 409, "conflict", { code: "help_request_already_claimed" }),
  );
  await render(<HelpRequestScreen />);
  await fireEvent.press(screen.getByLabelText("Claim request"));
  await screen.findByText("Another helper has already claimed this request.");
  expect(mockLoad).toHaveBeenCalled();
});
it("uses server-provided action permissions and displays team meeting instructions (H64)", async () => {
  mockRequest = {
    ...mockRequest,
    status: "claimed",
    claim: {
      helper: null,
      mode: "meet_at",
      meetingLocation: "Mentor corner",
      claimedAt: "2027-02-20T09:00:00Z",
    },
    viewer: { ...mockRequest.viewer, canClaim: false, canResolve: true },
  };
  await render(<HelpRequestScreen />);
  expect(screen.queryByLabelText("Claim request")).toBeNull();
  expect(screen.getByText("Come to this location: Mentor corner")).toBeTruthy();
  expect(screen.getByLabelText("Mark resolved")).toBeTruthy();
});
it("submits a team request using Other without inventing a topic (H64/H65)", async () => {
  mockMutate.mockResolvedValue({ ...mockRequest, id: 42 });
  await render(<NewHelpRequestScreen />);
  await fireEvent.press(screen.getByLabelText("Team Nine"));
  await fireEvent.changeText(screen.getByLabelText("What do you need?"), "Need hardware help");
  await fireEvent.changeText(screen.getByLabelText("Where are you?"), "Desk 5");
  await fireEvent.press(screen.getByLabelText("Other"));
  await fireEvent.press(screen.getByLabelText("Send request"));
  await waitFor(() =>
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: "/(tabs)/help-desk/request/[id]",
      params: { id: 42 },
    }),
  );
  expect(mockMutate).toHaveBeenCalledWith("/api/helpdesk/requests", {
    description: "Need hardware help",
    location: "Desk 5",
    topicIds: [],
    other: true,
    projectId: 9,
  });
});
