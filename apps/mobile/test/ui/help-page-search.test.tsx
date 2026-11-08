import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

const mockSetOptions = jest.fn();
jest.mock("expo-router", () => ({
  useFocusEffect: jest.fn(),
  useNavigation: () => ({ setOptions: mockSetOptions }),
  useRouter: () => ({}),
}));
jest.mock("expo-router/stack", () => {
  const Stack = {
    Screen: (props: { options: unknown }) => {
      mockSetOptions(props.options);
      return null;
    },
  };
  return { __esModule: true, default: Stack, Stack };
});
jest.mock("@/components/app-refresh-control", () => ({ AppRefreshControl: () => null }));
jest.mock("@/components/glass-view", () => ({ isRealLiquidGlassAvailable: () => false }));
jest.mock("@/components/header-back-button", () => ({ EntryBackToolbar: () => null }));
jest.mock("@/components/native-ui", () => ({ Section: () => null, StatusPill: () => null }));
jest.mock("@/components/pressable-feedback", () => ({ PressableFeedback: () => null }));
jest.mock("@/components/project-ui", () => ({ CircleButton: () => null }));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/theme/colors", () => ({ colors: new Proxy({}, { get: () => "#000" }) }));
jest.mock("@/lib/bar-title", () => ({ useBarTitleOptions: () => ({}) }));
jest.mock("@/lib/help-topic-selection", () => ({
  seedTopicSelection: jest.fn(),
  useTopicSelection: () => ({ selected: [] }),
}));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (k: string) => k }) }));
jest.mock("@/lib/notification-events", () => ({ subscribeToNotificationChanges: jest.fn() }));
jest.mock("@/lib/router-tabs-inset", () => ({ useRouterTabBarScrollBottomInset: () => 0 }));
jest.mock("@/lib/server-events", () => ({
  startDomainEventStream: jest.fn(),
  subscribeToServerEvent: jest.fn(),
}));
jest.mock("@/theme", () => ({
  colors: new Proxy({}, { get: () => "#000" }),
  radius: new Proxy({}, { get: () => 8 }),
  space: new Proxy({}, { get: () => 8 }),
  type: new Proxy({}, { get: () => ({}) }),
}));
jest.mock("@/theme/layout-participant", () => ({ useParticipantLayout: () => ({ content: {} }) }));

import { Platform } from "react-native";
import { HelpPage, helpSearchSurface } from "@/components/help-desk/primitives";

const search = { placeholder: "Find a helper", onChange: jest.fn() };
const original = Platform.OS;
afterEach(() => {
  Object.defineProperty(Platform, "OS", { value: original, configurable: true });
  mockSetOptions.mockClear();
});

function setOs(os: string) {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true });
}

describe("help desk search surface", () => {
  it("maps platforms to exactly one surface", () => {
    expect(helpSearchSurface("ios")).toBe("native");
    expect(helpSearchSurface("android")).toBe("inline");
  });

  it("iOS: native header search only, no inline field", async () => {
    setOs("ios");
    await render(
      <HelpPage title="Helpers" search={search}>
        <Text>body</Text>
      </HelpPage>,
    );
    expect(mockSetOptions.mock.calls[0][0].headerSearchBarOptions).toMatchObject({
      placeholder: "Find a helper",
      placement: "integratedButton",
    });
    expect(screen.queryByPlaceholderText("Find a helper")).toBeNull();
  });

  it("Android: one inline field, no native header search", async () => {
    setOs("android");
    await render(
      <HelpPage title="Helpers" search={search}>
        <Text>body</Text>
      </HelpPage>,
    );
    expect(mockSetOptions.mock.calls[0][0].headerSearchBarOptions).toBeUndefined();
    expect(screen.getAllByPlaceholderText("Find a helper")).toHaveLength(1);
  });

  it("renders no search when the screen has none", async () => {
    setOs("android");
    await render(
      <HelpPage title="Helpers">
        <Text>body</Text>
      </HelpPage>,
    );
    expect(screen.queryByPlaceholderText("Find a helper")).toBeNull();
  });
});
