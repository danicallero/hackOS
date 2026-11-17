import { CAPABILITIES } from "@hackos/shared/capabilities";
import { render } from "@testing-library/react-native";

const mockCapabilities: string[] = [];
const mockRedirect = jest.fn();
jest.mock("expo-router", () => ({
  Redirect: (props: { href: string }) => {
    mockRedirect(props.href);
    return null;
  },
  useNavigation: () => ({ setOptions: jest.fn() }),
  useSegments: () => [],
}));
jest.mock("expo-router/stack", () => {
  const Stack = ({ children }: { children: unknown }) => children;
  Stack.Screen = () => null;
  return { Stack };
});
jest.mock("@/lib/me-context", () => ({
  useMeContext: () => ({ me: { capabilities: mockCapabilities } }),
}));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
jest.mock("@/lib/navigation", () => ({
  helpSheetOptions: {},
  useTabStackScreenOptions: () => ({}),
  transparentDetailHeaderOptions: {},
}));
jest.mock("@/components/glass-view", () => ({ isRealLiquidGlassAvailable: () => false }));
jest.mock("@/theme/colors", () => ({ colors: {} }));
jest.mock("@/lib/screen-header-options", () => ({ fixedScrollHeaderOptions: () => ({}) }));
jest.mock("@/components/opaque-router-tabs", () => ({
  OpaqueRouterTabs: () => null,
  tabLabelKeyForSegment: () => null,
}));

import { unstable_settings as tabSettings } from "@/app/(tabs)/_layout";
import ActivitiesLayout from "@/app/(tabs)/activities/_layout";
import HelpDeskLayout from "@/app/(tabs)/help-desk/_layout";
import OperationsLayout from "@/app/(tabs)/operations/_layout";
import ScannerLayout from "@/app/(tabs)/scan/_layout";

// H8/H22/H55: hidden scanner routes must reject every unauthorized entry method.
describe("scanner route access", () => {
  beforeEach(() => {
    mockCapabilities.length = 0;
    mockRedirect.mockClear();
  });
  it("redirects a normal participant away from the scanner stack", async () => {
    await render(<ScannerLayout />);
    expect(mockRedirect).toHaveBeenCalledWith("/(tabs)/schedule");
  });
  it("stops scanner access when scan capabilities are revoked", async () => {
    mockCapabilities.push(CAPABILITIES.ACCREDIT_SCAN);
    const view = await render(<ScannerLayout />);
    expect(mockRedirect).not.toHaveBeenCalled();
    mockCapabilities.length = 0;
    await view.rerender(<ScannerLayout />);
    expect(mockRedirect).toHaveBeenCalledWith("/(tabs)/schedule");
  });
  it.each([
    CAPABILITIES.ACCREDIT_SCAN,
    CAPABILITIES.PRESENCE_SCAN,
    CAPABILITIES.ACTIVITY_SCAN,
    CAPABILITIES.ADMIN_ALL,
  ])("allows %s", async (capability) => {
    mockCapabilities.push(capability);
    await render(<ScannerLayout />);
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});

// H8/H55: every tab route is registered for every account; each hidden stack checks its own capability.
describe("hidden tab route access", () => {
  beforeEach(() => {
    mockCapabilities.length = 0;
    mockRedirect.mockClear();
  });

  it.each([
    ["activities", ActivitiesLayout, CAPABILITIES.ACTIVITY_SCAN],
    ["operations", OperationsLayout, CAPABILITIES.QUEUE_OPERATE],
    ["help desk", HelpDeskLayout, CAPABILITIES.HELPDESK_REQUEST],
  ])("redirects a participant away from %s and allows its capability", async (_name, Layout, capability) => {
    await render(<Layout />);
    expect(mockRedirect).toHaveBeenCalledWith("/(tabs)/schedule");
    mockRedirect.mockClear();
    mockCapabilities.push(capability);
    await render(<Layout />);
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  // A tab-level back returns to the first route; it must be the one tab everyone has.
  it("makes Schedule the tab router's first route", () => {
    expect(tabSettings.initialRouteName).toBe("schedule");
  });
});
