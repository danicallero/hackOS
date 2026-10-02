import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { QrCamera } from "@/components/QrCamera";

let mockCameraProps: { onBarcodeScanned?: unknown };
let mockReaderProps: { visible: boolean; onClose: () => void; onValue: (uid: string) => void };
let mockFocused = true;
let mockPermission = { granted: true, canAskAgain: true };
jest.mock("expo-camera", () => ({
  useCameraPermissions: () => [mockPermission, jest.fn()],
  CameraView: (props: typeof mockCameraProps) => {
    mockCameraProps = props;
    return null;
  },
}));
jest.mock("expo-router", () => ({ useIsFocused: () => mockFocused }));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock("@/lib/router-tabs-inset", () => ({ useRouterTabBarBottomInset: () => 0 }));
jest.mock("@/components/glass-view", () => ({
  GlassView: ({ children }: { children: unknown }) => children,
}));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/modules/camera-capabilities", () => ({
  __esModule: true,
  default: { hasBackCameraTorch: () => true },
}));
jest.mock("@/theme/colors", () => ({
  colors: { background: "black", label: "white", accent: "blue", accentText: "white" },
}));
jest.mock("@/lib/haptics", () => ({ haptic: jest.fn() }));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
jest.mock("@/components/nfc-reader", () => ({
  NfcReader: (props: typeof mockReaderProps) => {
    mockReaderProps = props;
    return null;
  },
}));

beforeEach(() => {
  mockFocused = true;
  mockPermission = { granted: true, canAskAgain: true };
});

it("opens NFC from the camera, pauses QR decoding and resumes after cancel", async () => {
  const view = await render(<QrCamera onValue={jest.fn()} />);
  expect(mockCameraProps.onBarcodeScanned).toBeDefined();
  await fireEvent.press(view.getByRole("button", { name: "scannerNfcScan" }));
  await waitFor(() => expect(mockReaderProps.visible).toBe(true));
  expect(mockCameraProps.onBarcodeScanned).toBeUndefined();
  await act(() => mockReaderProps.onClose());
  expect(mockReaderProps.visible).toBe(false);
  expect(mockCameraProps.onBarcodeScanned).toBeDefined();
});

it("auto-opens only once after the meal loads and can be reopened manually", async () => {
  const onValue = jest.fn();
  const view = await render(<QrCamera onValue={onValue} autoStartNfc={false} />);
  expect(mockReaderProps.visible).toBe(false);
  await view.rerender(<QrCamera onValue={onValue} autoStartNfc />);
  await waitFor(() => expect(mockReaderProps.visible).toBe(true));
  await act(() => mockReaderProps.onClose());
  await view.rerender(<QrCamera onValue={onValue} autoStartNfc />);
  expect(mockReaderProps.visible).toBe(false);
  await fireEvent.press(view.getByRole("button", { name: "scannerNfcScan" }));
  await waitFor(() => expect(mockReaderProps.visible).toBe(true));
  await act(() => mockReaderProps.onValue("04AB12CD34EF56"));
  expect(onValue).toHaveBeenCalledWith("04AB12CD34EF56");
});

it("allows NFC without camera permission", async () => {
  mockPermission = { granted: false, canAskAgain: false };
  const view = await render(<QrCamera onValue={jest.fn()} />);
  await fireEvent.press(view.getByRole("button", { name: "scannerNfcScan" }));
  await waitFor(() => expect(mockReaderProps.visible).toBe(true));
});

it("blocks NFC while a result needs attention and closes on navigation", async () => {
  const onValue = jest.fn();
  const view = await render(<QrCamera onValue={onValue} scanningEnabled={false} />);
  expect(view.getByRole("button", { name: "scannerNfcScan" })).toBeDisabled();
  await view.rerender(<QrCamera onValue={onValue} />);
  await fireEvent.press(view.getByRole("button", { name: "scannerNfcScan" }));
  await waitFor(() => expect(mockReaderProps.visible).toBe(true));
  mockFocused = false;
  await view.rerender(<QrCamera onValue={onValue} />);
  await waitFor(() => expect(mockReaderProps.visible).toBe(false));
});
