jest.mock("@/lib/use-nfc-supported", () => ({
  useNfcSupportStatus: () => (mockNfcSupported ? "supported" : "unsupported"),
  useNfcSupported: () => mockNfcSupported,
}));

import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import { QrCamera } from "@/components/QrCamera";

let mockCameraProps: { onBarcodeScanned?: unknown };
let mockReaderProps: { visible: boolean; onClose: () => void; onValue: (uid: string) => void };
let mockNfcSupported = true;
let mockFocused = true;
type MockPermission = {
  status: "granted" | "undetermined" | "denied";
  granted: boolean;
  canAskAgain: boolean;
};
let mockPermission: MockPermission = { status: "granted", granted: true, canAskAgain: true };
const mockRequestCameraPermission = jest.fn();
jest.mock("expo-camera", () => ({
  useCameraPermissions: () => [mockPermission, mockRequestCameraPermission],
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

const originalOS = Platform.OS;
beforeEach(() => {
  mockNfcSupported = true;
  mockFocused = true;
  mockPermission = { status: "granted", granted: true, canAskAgain: true };
  mockRequestCameraPermission.mockReset();
});
afterEach(() => {
  Platform.OS = originalOS;
});

it("requests camera access only when its scanner surface is focused", async () => {
  mockPermission = { status: "undetermined", granted: false, canAskAgain: true };
  mockFocused = false;
  const view = await render(<QrCamera onValue={jest.fn()} />);

  expect(mockRequestCameraPermission).not.toHaveBeenCalled();
  mockFocused = true;
  await view.rerender(<QrCamera onValue={jest.fn()} />);
  await waitFor(() => expect(mockRequestCameraPermission).toHaveBeenCalledTimes(1));
});

it("defers camera permission while the activity scanner starts NFC", async () => {
  mockPermission = { status: "undetermined", granted: false, canAskAgain: true };
  await render(<QrCamera onValue={jest.fn()} autoStartNfc requestCameraOnFocus={false} />);
  await waitFor(() => expect(mockReaderProps.visible).toBe(true));
  expect(mockRequestCameraPermission).not.toHaveBeenCalled();
});

it("waits for an explicit QR choice after the activity NFC session is canceled", async () => {
  mockPermission = { status: "undetermined", granted: false, canAskAgain: true };
  const view = await render(
    <QrCamera onValue={jest.fn()} autoStartNfc requestCameraOnFocus={false} />,
  );
  await waitFor(() => expect(mockReaderProps.visible).toBe(true));
  await act(() => mockReaderProps.onClose());

  expect(mockRequestCameraPermission).not.toHaveBeenCalled();
  await fireEvent.press(view.getByRole("button", { name: "scannerCamera" }));
  expect(mockRequestCameraPermission).toHaveBeenCalledTimes(1);
});

it("does not automatically retry a denied camera request", async () => {
  Platform.OS = "android";
  mockPermission = { status: "denied", granted: false, canAskAgain: true };
  const view = await render(<QrCamera onValue={jest.fn()} />);
  expect(mockRequestCameraPermission).not.toHaveBeenCalled();
  expect(view.getByRole("button", { name: "scannerRetryCamera" })).toBeTruthy();
});

it("allows an explicit camera retry after denial when the platform permits it", async () => {
  Platform.OS = "android";
  mockPermission = { status: "denied", granted: false, canAskAgain: true };
  const view = await render(<QrCamera onValue={jest.fn()} />);
  await fireEvent.press(view.getByRole("button", { name: "scannerRetryCamera" }));
  expect(mockRequestCameraPermission).toHaveBeenCalledTimes(1);
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
  mockPermission = { status: "denied", granted: false, canAskAgain: false };
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

it("reopens NFC after each dismissed activity result but not after reader cancellation", async () => {
  const onValue = jest.fn();
  const view = await render(<QrCamera onValue={onValue} autoStartNfc />);
  await act(() => mockReaderProps.onClose());
  expect(mockReaderProps.visible).toBe(false);
  await view.rerender(<QrCamera onValue={onValue} autoStartNfc scanningEnabled={false} />);
  await view.rerender(<QrCamera onValue={onValue} autoStartNfc nfcSessionKey={1} />);
  expect(mockReaderProps.visible).toBe(true);
  await act(() => mockReaderProps.onClose());
  await view.rerender(<QrCamera onValue={onValue} autoStartNfc nfcSessionKey={1} />);
  expect(mockReaderProps.visible).toBe(false);
  await view.rerender(
    <QrCamera onValue={onValue} autoStartNfc scanningEnabled={false} nfcSessionKey={2} />,
  );
  expect(mockReaderProps.visible).toBe(false);
  await view.rerender(<QrCamera onValue={onValue} autoStartNfc nfcSessionKey={2} />);
  expect(mockReaderProps.visible).toBe(true);
});

it("hides NFC controls and never auto-starts on unsupported hardware", async () => {
  mockNfcSupported = false;
  const view = await render(<QrCamera onValue={jest.fn()} autoStartNfc nfcSessionKey={1} />);
  expect(view.queryByRole("button", { name: "scannerNfcScan" })).toBeNull();
  expect(mockReaderProps.visible).toBe(false);
  expect(mockCameraProps.onBarcodeScanned).toBeDefined();
  mockPermission = { status: "denied", granted: false, canAskAgain: false };
  await view.rerender(<QrCamera onValue={jest.fn()} autoStartNfc />);
  expect(view.queryByRole("button", { name: "scannerNfcScan" })).toBeNull();
});
