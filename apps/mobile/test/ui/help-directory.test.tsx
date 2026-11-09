jest.mock("@/theme/colors", () => ({ colors: new Proxy({}, { get: () => "#000" }) }));

import { act, render, screen, waitFor } from "@testing-library/react-native";
import { Text as MockText } from "react-native";

const mockFetch = jest.fn();
jest.mock("@/components/filter-menu", () => ({ FilterMenu: () => null }));
jest.mock("@/components/app-menu", () => ({ MenuView: () => null }));
jest.mock("expo-router", () => ({
  useFocusEffect: (cb: () => unknown) => require("react").useEffect(cb, [cb]),
  useRouter: () => ({ push: jest.fn() }),
  useNavigation: () => ({ setOptions: jest.fn() }),
}));
jest.mock("expo-router/stack", () => ({
  __esModule: true,
  default: { Screen: () => null },
  Stack: {},
}));
jest.mock("@/lib/api", () => ({ apiFetch: (...a: unknown[]) => mockFetch(...a) }));
jest.mock("@/lib/me-context", () => ({
  useMeContext: () => ({ me: { capabilities: ["helpdesk:request"] } }),
}));
jest.mock("@/components/app-refresh-control", () => ({ AppRefreshControl: () => null }));
jest.mock("@/components/glass-view", () => ({ isRealLiquidGlassAvailable: () => false }));
jest.mock("@/components/header-back-button", () => ({ EntryBackToolbar: () => null }));
jest.mock("@/components/native-ui", () => ({
  EmptyState: ({ title }: { title: string }) => <MockText>{title}</MockText>,
  Section: () => null,
  Separator: () => null,
  StatusPill: () => null,
}));
jest.mock("@/components/RequestFeedback", () => ({
  RequestFeedback: ({ loading, error }: { loading?: boolean; error?: Error | null }) =>
    loading ? (
      <MockText>LOADING</MockText>
    ) : error ? (
      <MockText>ERROR {error.message}</MockText>
    ) : null,
}));
jest.mock("@/components/help-desk/rows", () => ({ HelperRow: () => null }));
jest.mock("@/components/pressable-feedback", () => ({ PressableFeedback: () => null }));
jest.mock("@/components/project-ui", () => ({ CircleButton: () => null }));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/lib/bar-title", () => ({ useBarTitleOptions: () => ({}) }));
jest.mock("@/lib/help-topic-selection", () => ({
  seedTopicSelection: jest.fn(),
  useTopicSelection: () => ({ selected: [] }),
}));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
jest.mock("@/lib/notification-events", () => ({ subscribeToNotificationChanges: () => () => {} }));
jest.mock("@/lib/router-tabs-inset", () => ({ useRouterTabBarScrollBottomInset: () => 0 }));
jest.mock("@/lib/server-events", () => ({
  startDomainEventStream: () => () => {},
  subscribeToServerEvent: () => () => {},
}));
jest.mock("@/theme", () => ({
  colors: new Proxy({}, { get: () => "#000" }),
  radius: new Proxy({}, { get: () => 8 }),
  space: new Proxy({}, { get: () => 8 }),
  type: new Proxy({}, { get: () => ({}) }),
}));
jest.mock("@/theme/layout-participant", () => ({ useParticipantLayout: () => ({ content: {} }) }));

import { HelpersScreen } from "@/components/help-desk/directory-screen";

afterEach(() => mockFetch.mockReset());

describe("Helpers directory states", () => {
  it("shows loading, then the empty state", async () => {
    let release: (value: unknown) => void = () => {};
    mockFetch.mockReturnValue(new Promise((resolve) => (release = resolve)));
    await render(<HelpersScreen />);
    expect(screen.getByText("LOADING")).toBeTruthy();
    await act(async () => release({ helpers: [] }));
    await waitFor(() => expect(screen.getByText("helpNoHelpers")).toBeTruthy());
    expect(screen.queryByText("LOADING")).toBeNull();
  });

  it("shows an error instead of an endless spinner when the request fails", async () => {
    mockFetch.mockRejectedValue(new Error("down"));
    await render(<HelpersScreen />);
    await waitFor(() => expect(screen.getByText("ERROR down")).toBeTruthy());
    expect(screen.queryByText("LOADING")).toBeNull();
  });
});
