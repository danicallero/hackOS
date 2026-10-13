jest.mock("@/components/scanner-code-entry-actions", () =>
  jest.requireActual("@/components/scanner-code-entry-actions.tsx"),
);

jest.mock("@/components/scanner-action-button", () =>
  jest.requireActual("@/components/scanner-action-button.tsx"),
);

jest.mock("@/lib/use-nfc-supported", () => ({
  useNfcSupportStatus: () => (mockNfcSupported ? "supported" : "unsupported"),
  useNfcSupported: () => mockNfcSupported,
}));

import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Platform } from "react-native";
import { QrCamera } from "@/components/QrCamera";

let mockCameraProps: { onBarcodeScanned?: unknown };
let mockReaderProps: {
  visible: boolean;
  showAndroidOverlay: boolean;
  onClose: () => void;
  onValue: (uid: string) => void;
};
let mockNfcSupported = true;
let mockFocused = true;
type MockPermission = {
  status: "granted" | "undetermined" | "denied";
  granted: boolean;
  canAskAgain: boolean;
};
let mockPermission: MockPermission = { status: "granted", granted: true, canAskAgain: true };
const mockRequestCameraPermission = jest.fn();
const mockUseCameraPermissions = jest.fn();
const mockCameraMounted = jest.fn();
jest.mock("expo-camera", () => ({
  useCameraPermissions: () => {
    mockUseCameraPermissions();
    return [mockPermission, mockRequestCameraPermission];
  },
  CameraView: (props: typeof mockCameraProps) => {
    const React = require("react");
    React.useEffect(() => {
      mockCameraMounted(true);
      return () => mockCameraMounted(false);
    }, []);
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
  mockUseCameraPermissions.mockReset();
  mockCameraMounted.mockReset();
});

it("starts Android NFC automatically and toggles it only from the symbol", async () => {
  Platform.OS = "android";
  const view = await render(<QrCamera nfcFirst onValue={jest.fn()} />);
  expect(mockReaderProps.visible).toBe(true);
  expect(mockReaderProps.showAndroidOverlay).toBe(false);
  expect(view.getAllByRole("button", { name: "scannerNfcStop" })).toHaveLength(1);
  expect(view.queryByText("scannerNfcStop")).toBeNull();
  await fireEvent.press(view.getByTestId("scanner-nfc-toggle"));
  expect(mockReaderProps.visible).toBe(false);
  await fireEvent.press(view.getByTestId("scanner-nfc-toggle"));
  expect(mockReaderProps.visible).toBe(true);
  await fireEvent.press(view.getByRole("button", { name: "scannerCamera" }));
  expect(mockReaderProps.visible).toBe(false);
  expect(mockCameraMounted).toHaveBeenLastCalledWith(true);
});

it("keeps the granted camera unmounted until explicitly opened and unmounts on close", async () => {
  const onClose = jest.fn();
  const view = await render(<QrCamera nfcFirst onValue={jest.fn()} onClose={onClose} />);
  expect(mockUseCameraPermissions).not.toHaveBeenCalled();
  expect(mockCameraMounted).not.toHaveBeenCalled();
  expect(view.getAllByRole("button", { name: "scannerNfcScan" })[0]!).toBeTruthy();
  await fireEvent.press(view.getByRole("button", { name: "scannerCamera" }));
  expect(mockCameraMounted).toHaveBeenLastCalledWith(true);
  await fireEvent.press(view.getByRole("button", { name: "back" }));
  expect(mockCameraMounted).toHaveBeenLastCalledWith(false);
  expect(view.getByRole("button", { name: "scannerCamera" })).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
});

it("requests camera permission only after opening the NFC-first camera fallback", async () => {
  mockPermission = { status: "undetermined", granted: false, canAskAgain: true };
  const view = await render(
    <QrCamera nfcFirst onValue={jest.fn()} autoStartNfc requestCameraOnFocus={false} />,
  );
  expect(mockReaderProps.visible).toBe(true);
  await act(() => mockReaderProps.onClose());
  expect(mockUseCameraPermissions).not.toHaveBeenCalled();
  expect(mockRequestCameraPermission).not.toHaveBeenCalled();
  await fireEvent.press(view.getByRole("button", { name: "scannerCamera" }));
  expect(mockRequestCameraPermission).toHaveBeenCalledTimes(1);
});

it("preserves NFC-first session keys without mounting a camera", async () => {
  const onValue = jest.fn();
  const view = await render(<QrCamera nfcFirst autoStartNfc onValue={onValue} />);
  expect(mockReaderProps.visible).toBe(true);
  await act(() => mockReaderProps.onClose());
  await view.rerender(<QrCamera nfcFirst autoStartNfc onValue={onValue} />);
  expect(mockReaderProps.visible).toBe(false);
  await view.rerender(<QrCamera nfcFirst autoStartNfc nfcSessionKey={1} onValue={onValue} />);
  expect(mockReaderProps.visible).toBe(true);
  expect(mockUseCameraPermissions).not.toHaveBeenCalled();
});

it("keeps unsupported NFC-first hardware camera-free and exposes fallbacks", async () => {
  mockNfcSupported = false;
  const view = await render(<QrCamera nfcFirst autoStartNfc onValue={jest.fn()} />);
  expect(view.queryByRole("button", { name: "scannerNfcScan" })).toBeNull();
  expect(view.getByRole("button", { name: "scannerCamera" })).toBeTruthy();
  expect(view.getByRole("button", { name: "scannerEnterManually" })).toBeTruthy();
  expect(mockUseCameraPermissions).not.toHaveBeenCalled();
});

it("accepts manual entry from the NFC surface without mounting a camera", async () => {
  const onValue = jest.fn();
  const view = await render(<QrCamera nfcFirst onValue={onValue} />);
  await fireEvent.press(view.getByRole("button", { name: "scannerEnterManually" }));
  await fireEvent.changeText(view.getByLabelText("scannerManualEntryTitle"), "BADGE-123");
  await fireEvent.press(view.getByRole("button", { name: "scannerRegister" }));
  expect(onValue).toHaveBeenCalledWith("BADGE-123");
  expect(mockUseCameraPermissions).not.toHaveBeenCalled();
});

it("disables NFC-first capture actions while a result needs attention", async () => {
  const view = await render(<QrCamera nfcFirst scanningEnabled={false} onValue={jest.fn()} />);
  for (const name of ["scannerNfcScan", "scannerCamera", "scannerEnterManually"]) {
    for (const control of view.getAllByRole("button", { name })) expect(control).toBeDisabled();
  }
  expect(mockUseCameraPermissions).not.toHaveBeenCalled();
});

it("lets an external NFC owner hide camera NFC controls and auto-start", async () => {
  const view = await render(
    <QrCamera hideNfc autoStartNfc nfcSessionKey={1} onValue={jest.fn()} />,
  );
  expect(view.queryByRole("button", { name: "scannerNfcScan" })).toBeNull();
  expect(mockReaderProps.visible).toBe(false);
  expect(mockCameraMounted).toHaveBeenLastCalledWith(true);
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
  await fireEvent.press(view.getAllByRole("button", { name: "scannerNfcScan" })[0]!);
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
  await fireEvent.press(view.getAllByRole("button", { name: "scannerNfcScan" })[0]!);
  await waitFor(() => expect(mockReaderProps.visible).toBe(true));
  await act(() => mockReaderProps.onValue("04AB12CD34EF56"));
  expect(onValue).toHaveBeenCalledWith("04AB12CD34EF56");
});

it("allows NFC without camera permission", async () => {
  mockPermission = { status: "denied", granted: false, canAskAgain: false };
  const view = await render(<QrCamera onValue={jest.fn()} />);
  await fireEvent.press(view.getAllByRole("button", { name: "scannerNfcScan" })[0]!);
  await waitFor(() => expect(mockReaderProps.visible).toBe(true));
});

it("blocks NFC while a result needs attention and closes on navigation", async () => {
  const onValue = jest.fn();
  const view = await render(<QrCamera onValue={onValue} scanningEnabled={false} />);
  expect(view.getAllByRole("button", { name: "scannerNfcScan" })[0]!).toBeDisabled();
  await view.rerender(<QrCamera onValue={onValue} />);
  await fireEvent.press(view.getAllByRole("button", { name: "scannerNfcScan" })[0]!);
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
