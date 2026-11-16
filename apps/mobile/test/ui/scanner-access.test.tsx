import { CAPABILITIES } from "@hackos/shared/capabilities";
import { render } from "@testing-library/react-native";

const mockCapabilities: string[] = [];
const mockRedirect = jest.fn();
jest.mock("expo-router", () => ({
  Redirect: (props: { href: string }) => {
    mockRedirect(props.href);
    return null;
  },
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
  useTabStackScreenOptions: () => ({}),
  transparentDetailHeaderOptions: {},
}));
jest.mock("@/components/glass-view", () => ({ isRealLiquidGlassAvailable: () => false }));
jest.mock("@/theme/colors", () => ({ colors: {} }));

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
