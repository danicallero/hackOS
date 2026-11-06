import { fireEvent, render, screen } from "@testing-library/react-native";

const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockRoutes = [{ key: "entry" }];
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack, canGoBack: () => true }),
  useNavigation: () => ({ getState: () => ({ routes: mockRoutes }) }),
  useRoute: () => ({ key: "entry" }),
}));
jest.mock("expo-router/stack", () => {
  const { Pressable, View } = require("react-native");
  return { __esModule: true, default: { Toolbar: Object.assign(View, { Button: Pressable }) } };
});
jest.mock("@/components/glass-view", () => ({ isRealLiquidGlassAvailable: () => true }));
jest.mock("@/theme/colors", () => ({ colors: { label: "#000000" } }));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: () => "Back" }) }));
jest.mock("@/lib/haptics", () => ({ haptic: jest.fn() }));

import { EntryBackToolbar } from "@/components/header-back-button";

afterEach(() => {
  jest.clearAllMocks();
  mockRoutes = [{ key: "entry" }];
});

test("H55: a direct entry returns to its owner even when parent tab history exists", async () => {
  await render(<EntryBackToolbar fallback="/(tabs)/others/account" />);
  await fireEvent.press(screen.getByLabelText("Back"));
  expect(mockReplace).toHaveBeenCalledWith("/(tabs)/others/account");
  expect(mockBack).not.toHaveBeenCalled();
});

test("H55: a pushed screen keeps the system back item", async () => {
  mockRoutes = [{ key: "account" }, { key: "entry" }];
  await render(<EntryBackToolbar fallback="/(tabs)/others/account" />);
  expect(screen.queryByLabelText("Back")).toBeNull();
});
