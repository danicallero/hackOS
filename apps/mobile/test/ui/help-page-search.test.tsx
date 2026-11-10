import { render, screen } from "@testing-library/react-native";
import { Text } from "react-native";

const mockSetOptions = jest.fn();
let mockGlass = false;
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
    Toolbar: Object.assign(() => null, { View: () => null, Button: () => null }),
  };
  return { __esModule: true, default: Stack, Stack };
});
jest.mock("@/components/app-refresh-control", () => ({ AppRefreshControl: () => null }));
jest.mock("@/components/glass-view", () => ({ isRealLiquidGlassAvailable: () => mockGlass }));
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
  mockGlass = false;
});

/** The host scroll view around an element, for asserting its native props. */
function scrollOf(element: { parent: unknown; type: unknown }) {
  let node = element as { parent: unknown; type: unknown; props?: Record<string, unknown> } | null;
  while (node && node.type !== "RCTScrollView") node = node.parent as typeof node;
  if (!node) throw new Error("no scroll view");
  return node as { props: Record<string, unknown> };
}

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

  it("glass: a pushed page with a fixed title gets the fixed header and native search from ONE options call", async () => {
    setOs("ios");
    mockGlass = true;
    await render(
      <HelpPage title="Helpers" fixedTitle search={search}>
        <Text>body</Text>
      </HelpPage>,
    );
    // Only navigation.setOptions: a <Stack.Screen> would replace these with a large title.
    expect(mockSetOptions).toHaveBeenCalledTimes(1);
    expect(mockSetOptions.mock.calls[0][0]).toMatchObject({
      headerLargeTitle: false,
      headerTransparent: true,
      headerBlurEffect: "none",
      scrollEdgeEffects: { top: "soft" },
      headerBackVisible: true,
      headerSearchBarOptions: { placeholder: "Find a helper", placement: "integratedButton" },
    });
    expect(mockSetOptions.mock.calls[0][0].headerStyle).toBeUndefined();
  });

  it("glass: a tab root with a fixed title hides the back item", async () => {
    setOs("ios");
    mockGlass = true;
    await render(
      <HelpPage title="Help desk" fixedTitle showBack={false}>
        <Text>body</Text>
      </HelpPage>,
    );
    expect(mockSetOptions.mock.calls[0][0].headerBackVisible).toBe(false);
    expect(mockSetOptions.mock.calls[0][0].headerSearchBarOptions).toBeUndefined();
  });

  it("only form pages get the automatic keyboard inset; lists dismiss on drag", async () => {
    setOs("ios");
    await render(
      <HelpPage title="Helpers" search={search}>
        <Text>body</Text>
      </HelpPage>,
    );
    const list = scrollOf(screen.getByText("body"));
    expect(list.props.automaticallyAdjustKeyboardInsets).toBe(false);
    expect(list.props.keyboardDismissMode).toBe("on-drag");
  });

  it("a form page keeps the keyboard inset and interactive dismissal", async () => {
    setOs("ios");
    await render(
      <HelpPage title="Request help" form onClose={jest.fn()}>
        <Text>body</Text>
      </HelpPage>,
    );
    const form = scrollOf(screen.getByText("body"));
    expect(form.props.automaticallyAdjustKeyboardInsets).toBe(true);
    expect(form.props.keyboardDismissMode).toBe("interactive");
  });
});
