import mockhelpDeskEn from "@hackos/shared/locales/en/mobile.json";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import {
  Alert,
  Pressable as MockPressable,
  Text as MockText,
  TextInput as MockTextInput,
  View as MockView,
} from "react-native";
import { HelpRequestScreen } from "@/components/help-desk/request-screen";
import { HelpRequestList, NewHelpRequestScreen } from "@/components/help-desk/requests-screen";
import { ApiError } from "@/lib/api";
import type { HelpRequest } from "@/lib/help-desk";

const mockMutate = jest.fn();
const mockReplace = jest.fn();
const mockLoad = jest.fn();
const mockSetData = jest.fn();
let mockRequest: HelpRequest;
let mockCaps = ["helpdesk:request"];
let mockEdit: string | undefined;
let mockOverrides: Record<string, { data?: unknown; loading?: boolean; error?: Error | null }> = {};
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack, push: jest.fn() }),
  useLocalSearchParams: () => ({ id: "41", edit: mockEdit }),
}));
jest.mock("expo-router/stack", () => ({ __esModule: true, default: {}, Stack: {} }));
jest.mock("@/components/glass-view", () => ({ isRealLiquidGlassAvailable: () => false }));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/components/pressable-feedback", () => ({ PressableFeedback: () => null }));
const mockAlert = jest.fn();
jest.mock("@/lib/alert", () => ({
  alert: (...args: unknown[]) => mockAlert(...args),
  confirmDestructive: jest.fn(),
}));
jest.mock("@/components/app-menu", () => ({
  MenuView: ({
    actions,
    onPressAction,
  }: {
    actions: { id: string; title: string }[];
    onPressAction: (event: { nativeEvent: { event: string } }) => void;
  }) => (
    <MockView>
      {actions.map((action) => (
        <MockPressable
          key={action.id}
          accessibilityRole="menuitem"
          accessibilityLabel={action.title}
          onPress={() => onPressAction({ nativeEvent: { event: action.id } })}
        />
      ))}
    </MockView>
  ),
}));
jest.mock("@/components/searchable-picker", () => ({
  CheckRow: ({
    label,
    selected,
    onPress,
  }: {
    label: string;
    selected: boolean;
    onPress: () => void;
  }) => (
    <MockPressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
    />
  ),
}));
jest.mock("@/lib/use-help-resource", () => ({
  useHelpResource: (path: string | null) => ({
    data:
      path === null
        ? null
        : path === "/api/helpdesk/projects"
          ? { projects: [{ id: 9, name: "Team Nine" }] }
          : mockRequest,
    loading: false,
    error: null,
    load: mockLoad,
    setData: mockSetData,
    ...(path ? mockOverrides[path] : {}),
  }),
}));
jest.mock("@/lib/use-help-draft-guard", () => ({ useHelpDraftGuard: jest.fn() }));
jest.mock("@/lib/me-context", () => ({
  useMeContext: () => ({ me: { id: 7, capabilities: mockCaps } }),
}));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string, params: Record<string, string> = {}) =>
      (
        ({ ...mockhelpDeskEn, cancel: "Cancel" })[key as keyof typeof mockhelpDeskEn] ?? key
      ).replace(/\{(\w+)\}/g, (_: string, name: string) => params[name] ?? ""),
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
  RequestFeedback: ({ error }: { error?: Error | null }) =>
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
  HELP_STATUS: new Proxy({}, { get: () => ({ label: "helpOpen", symbol: "circle" }) }),
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
  EmptyState: ({ title, action }: { title: string; action?: React.ReactNode }) => (
    <MockView>
      <MockText>{title}</MockText>
      {action}
    </MockView>
  ),
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
  // The real field opens the picker sheet; here Other and the challenge are one tap each.
  TopicField: ({
    other,
    onOtherChange,
  }: {
    other?: boolean;
    onOtherChange?: (value: boolean) => void;
  }) =>
    onOtherChange ? (
      <MockPressable
        accessibilityRole="button"
        accessibilityLabel="Other"
        onPress={() => onOtherChange(!other)}
      />
    ) : null,
  ChallengeField: ({
    onChange,
  }: {
    onChange: (challenge: { id: number; name: string }) => void;
  }) => (
    <MockPressable
      accessibilityRole="button"
      accessibilityLabel="Challenge"
      onPress={() => onChange({ id: 5, name: "Best API" })}
    />
  ),
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
    queuedAt: "2027-02-20T09:00:00Z",
    queuePosition: 1,
    challenge: null,
    preferSponsor: false,
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
      canEdit: false,
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
  const prompt = jest.spyOn(Alert, "prompt").mockImplementation(() => {});
  await render(<HelpRequestScreen />);
  await fireEvent.press(screen.getByLabelText(mockhelpDeskEn.helpMeetElsewhere));
  const buttons = prompt.mock.calls[0][2] as { onPress?: (value?: string) => void }[];
  await act(async () => {
    buttons[1].onPress?.("Sponsor stand");
    buttons[1].onPress?.("Sponsor stand");
  });
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
  await fireEvent.press(screen.getByLabelText(mockhelpDeskEn.helpOnWay));
  await screen.findByText("Someone else has already claimed this request.");
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
  expect(screen.queryByLabelText(mockhelpDeskEn.helpOnWay)).toBeNull();
  expect(screen.getByText(/Meet at Mentor corner/)).toBeTruthy();
  expect(screen.getByLabelText("Mark resolved")).toBeTruthy();
});
it("submits a team request using Other without inventing a topic (H64/H65)", async () => {
  mockMutate.mockResolvedValue({ ...mockRequest, id: 42 });
  await render(<NewHelpRequestScreen />);
  await fireEvent.press(screen.getByLabelText("Team Nine"));
  await fireEvent.changeText(screen.getByLabelText("What do you need?"), "Need hardware help");
  await fireEvent.changeText(screen.getByLabelText("Where are you?"), "Desk 5");
  await fireEvent.press(screen.getByLabelText("Other"));
  await fireEvent.press(screen.getByLabelText("Challenge"));
  await fireEvent.press(screen.getByLabelText("Prefer a sponsor"));
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
    challengeId: 5,
    preferSponsor: true,
  });
});

it("shows the challenge and sponsor preference on the request (H65)", async () => {
  mockRequest = { ...mockRequest, challenge: { id: 5, name: "Best API" }, preferSponsor: true };
  await render(<HelpRequestScreen />);
  expect(screen.getByText("Challenge: Best API")).toBeTruthy();
  expect(screen.getByText("Prefer a sponsor: Yes")).toBeTruthy();
});

it("edits an open request after confirming it moves to the end of the queue (H64)", async () => {
  mockEdit = "41";
  mockLoad.mockResolvedValue(undefined);
  mockMutate.mockResolvedValue(mockRequest);
  mockAlert.mockImplementation(
    (_title: string, _message: string, buttons: { text: string; onPress?: () => void }[]) =>
      buttons.find((button) => button.text === "Edit and move to end")?.onPress?.(),
  );
  await render(<NewHelpRequestScreen />);
  await fireEvent.changeText(screen.getByLabelText("What do you need?"), "Build still fails");
  await fireEvent.press(screen.getByLabelText("Save changes"));
  await waitFor(() =>
    expect(mockMutate).toHaveBeenCalledWith(
      "/api/helpdesk/requests/41",
      expect.objectContaining({ description: "Build still fails", challengeId: null }),
      "PATCH",
    ),
  );
  expect(mockBack).toHaveBeenCalled();
  mockEdit = undefined;
});

describe("editing a help request while its data is unavailable", () => {
  beforeEach(() => {
    mockEdit = "41";
    mockMutate.mockReset();
    mockLoad.mockReset();
  });
  afterEach(() => {
    mockEdit = undefined;
    mockOverrides = {};
  });

  it("offers retry instead of a blank form when the saved request failed to load", async () => {
    mockOverrides = {
      "/api/helpdesk/requests/41": { data: null, error: new Error("Couldn't load") },
    };
    await render(<NewHelpRequestScreen />);
    expect(screen.getByText("Couldn't load")).toBeTruthy();
    expect(screen.queryByLabelText("What do you need?")).toBeNull();
    await fireEvent.press(screen.getByLabelText("Save changes"));
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("shows no form while the saved request is still loading", async () => {
    mockOverrides = { "/api/helpdesk/requests/41": { data: null, loading: true } };
    await render(<NewHelpRequestScreen />);
    expect(screen.queryByLabelText("What do you need?")).toBeNull();
  });

  it("does not send an unchanged edit that would only lose the queue position", async () => {
    await render(<NewHelpRequestScreen />);
    await fireEvent.press(screen.getByLabelText("Save changes"));
    expect(mockAlert).not.toHaveBeenCalled();
    expect(mockMutate).not.toHaveBeenCalled();
  });
});

it("reports a failed team list on a new request instead of hiding it", async () => {
  mockOverrides = { "/api/helpdesk/projects": { data: null, error: new Error("Teams down") } };
  await render(<NewHelpRequestScreen />);
  expect(screen.getByText("Teams down")).toBeTruthy();
  mockOverrides = {};
});

describe("HelpRequestList states", () => {
  const resource = (requests: unknown[] | null, error: Error | null = null) =>
    ({
      data: requests ? { requests } : null,
      error,
      loading: false,
      load: jest.fn(),
      setData: jest.fn(),
    }) as never;

  it("says there are no requests when the server returned none", async () => {
    await render(<HelpRequestList path="/p" resource={resource([])} />);
    expect(screen.getByText("No help requests")).toBeTruthy();
  });

  it("tells a status filter that hid everything apart from an empty queue, and clears it", async () => {
    const onClear = jest.fn();
    await render(
      <HelpRequestList
        path="/p"
        statuses={["resolved"]}
        onClearFilters={onClear}
        resource={resource([{ id: 1, status: "open" }])}
      />,
    );
    expect(screen.queryByText("No help requests")).toBeNull();
    expect(screen.getByText("No results")).toBeTruthy();
    await fireEvent.press(screen.getByText("Clear filters"));
    expect(onClear).toHaveBeenCalled();
  });

  it("never reports an empty queue when the first load failed", async () => {
    await render(<HelpRequestList path="/p" resource={resource(null, new Error("Offline"))} />);
    expect(screen.getByText("Offline")).toBeTruthy();
    expect(screen.queryByText("No help requests")).toBeNull();
  });
});
