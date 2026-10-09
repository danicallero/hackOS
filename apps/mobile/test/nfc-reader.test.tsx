import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Alert, AppState, type AppStateStatus, Platform } from "react-native";
import { NfcReader } from "@/components/nfc-reader";
import { startNfcRead } from "@/lib/nfc-reader";

let mockFocused = true;
const mockTranslate = (key: string) => key;
jest.mock("expo-router", () => ({ useIsFocused: () => mockFocused }));
jest.mock("@/lib/nfc-reader", () => ({ startNfcRead: jest.fn() }));
jest.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: mockTranslate }) }));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));
jest.mock("@/theme/colors", () => ({
  colors: { background: "black", label: "white", accent: "blue" },
}));

const originalOS = Platform.OS;
let resolveRead: (uid: string | null) => void;
let rejectRead: (error: Error) => void;
const cancel = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = true;
  Platform.OS = "android";
  jest.mocked(startNfcRead).mockImplementation(() => ({
    result: new Promise((resolve, reject) => {
      resolveRead = resolve;
      rejectRead = reject;
    }),
    claimFailed: () => false,
    cancel,
  }));
});
afterEach(() => {
  Platform.OS = originalOS;
  jest.restoreAllMocks();
});

it("shows a cancelable Android overlay and submits one UID", async () => {
  const onValue = jest.fn();
  const onClose = jest.fn();
  const view = await render(<NfcReader visible onValue={onValue} onClose={onClose} />);
  expect(view.getByRole("header")).toHaveTextContent("scannerNfcScan");
  await act(() => resolveRead("04AB12CD34EF56"));
  expect(onValue).toHaveBeenCalledTimes(1);
  expect(onValue).toHaveBeenCalledWith("04AB12CD34EF56", { claimFailed: false });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("cancels without delivering a late tag after dismissing the overlay", async () => {
  const onValue = jest.fn();
  const onClose = jest.fn();
  const view = await render(<NfcReader visible onValue={onValue} onClose={onClose} />);
  await fireEvent.press(view.getByRole("button", { name: "cancel" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  await view.rerender(<NfcReader visible={false} onValue={onValue} onClose={onClose} />);
  expect(cancel).toHaveBeenCalledTimes(1);
  await act(() => resolveRead("04AB12CD34EF56"));
  expect(onValue).not.toHaveBeenCalled();
});

it("releases the reader on navigation without reopening on return", async () => {
  const onClose = jest.fn();
  const view = await render(<NfcReader visible onValue={jest.fn()} onClose={onClose} />);
  mockFocused = false;
  await view.rerender(<NfcReader visible onValue={jest.fn()} onClose={onClose} />);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("cancels on backgrounding and ignores a tag returned afterwards", async () => {
  let stateChanged!: (state: AppStateStatus) => void;
  const remove = jest.fn();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, callback) => {
    stateChanged = callback;
    return { remove };
  });
  const onValue = jest.fn();
  const onClose = jest.fn();
  await render(<NfcReader visible onValue={onValue} onClose={onClose} />);
  await act(() => stateChanged("background"));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
  await act(() => resolveRead("04AB12CD34EF56"));
  expect(onValue).not.toHaveBeenCalled();
});

it("shows a localized reader error without submitting a scan", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  const onValue = jest.fn();
  const onClose = jest.fn();
  await render(<NfcReader visible onValue={onValue} onClose={onClose} />);
  await act(() => rejectRead(new Error("scannerNfcDisabled")));
  await waitFor(() => expect(alert).toHaveBeenCalledWith("scannerNfcScan", "scannerNfcDisabled"));
  expect(onValue).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledTimes(1);
});
