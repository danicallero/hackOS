import { fireEvent, render, screen } from "@testing-library/react-native";
import { Platform } from "react-native";
import WalletRoute from "@/app/(tabs)/others/wallet";

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = false;
let mockHeaderOptions: Record<string, unknown>;
let mockWalletContentTop: number;
let mockNativeToolbar = true;
let mockSafeTop = 62;
const originalOS = Platform.OS;
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace, canGoBack: () => mockCanGoBack }),
}));
jest.mock("expo-router/stack", () => ({
  Stack: {
    Screen: ({ options }: { options: Record<string, unknown> }) => {
      mockHeaderOptions = options;
      return null;
    },
  },
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: mockSafeTop }),
}));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
jest.mock("@/components/glass-view", () => ({
  isRealLiquidGlassAvailable: () => mockNativeToolbar,
}));
jest.mock(
  "@/components/wallet-screen",
  () =>
    ({ contentTopInset }: { contentTopInset: number }) => {
      mockWalletContentTop = contentTopInset;
      return null;
    },
);
jest.mock("@/components/native-ui", () => ({
  AndroidStatusBarScrim: () => null,
  AdaptiveToolbarButton: ({
    accessibilityLabel,
    onPress,
  }: {
    accessibilityLabel: string;
    onPress: () => void;
  }) => {
    const { Pressable } = require("react-native");
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
      />
    );
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = false;
  mockNativeToolbar = true;
  mockSafeTop = 62;
});
afterEach(() => Object.defineProperty(Platform, "OS", { value: originalOS }));

it("closes a directly opened Wallet to Account without an empty top bar (H28)", async () => {
  await render(<WalletRoute />);
  expect(mockHeaderOptions).toMatchObject({
    headerShown: true,
    headerTransparent: true,
    headerBackVisible: false,
    title: "",
    headerTitle: "",
    headerShadowVisible: false,
  });
  expect(mockWalletContentTop).toBe(8);
  await fireEvent.press(screen.getByRole("button", { name: "close" }));
  expect(mockReplace).toHaveBeenCalledWith("/others/account");
  expect(mockBack).not.toHaveBeenCalled();
});

it("closes back to the originating screen when history exists (H28)", async () => {
  mockCanGoBack = true;
  await render(<WalletRoute />);
  await fireEvent.press(screen.getByRole("button", { name: "close" }));
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockReplace).not.toHaveBeenCalled();
});

it("keeps fallback controls clear of the status bar without reserving a native header", async () => {
  mockNativeToolbar = false;
  await render(<WalletRoute />);
  expect(mockHeaderOptions).toEqual({ headerShown: false });
  expect(mockWalletContentTop).toBe(52);
});

it("includes Android's status inset once for its floating close row", async () => {
  Object.defineProperty(Platform, "OS", { value: "android" });
  mockSafeTop = 24;
  await render(<WalletRoute />);
  expect(mockHeaderOptions).toEqual({ headerShown: false });
  expect(mockWalletContentTop).toBe(76);
});
