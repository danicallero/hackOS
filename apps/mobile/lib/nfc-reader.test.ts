import { Platform } from "react-native";
import NfcManager, { NfcError, NfcTech } from "react-native-nfc-manager";
import { startNfcRead } from "./nfc-reader";

jest.mock("react-native-nfc-manager", () => ({
  __esModule: true,
  default: {
    isSupported: jest.fn(),
    start: jest.fn(),
    isEnabled: jest.fn(),
    registerTagEvent: jest.fn(),
    unregisterTagEvent: jest.fn(),
    requestTechnology: jest.fn(),
    getTag: jest.fn(),
    cancelTechnologyRequest: jest.fn(),
  },
  NfcTech: { MifareIOS: "mifare", NfcA: "NfcA" },
  NfcAdapter: { FLAG_READER_NFC_A: 1, FLAG_READER_SKIP_NDEF_CHECK: 128 },
  NfcError: { UserCancel: class UserCancel extends Error {} },
}));

const originalOS = Platform.OS;
beforeEach(() => {
  jest.resetAllMocks();
  Platform.OS = "ios";
  jest.mocked(NfcManager.isSupported).mockResolvedValue(true);
  jest.mocked(NfcManager.isEnabled).mockResolvedValue(true);
  jest.mocked(NfcManager.getTag).mockResolvedValue({ id: "04:ab:12:cd:34:ef:56", ndefMessage: [] });
});
afterAll(() => {
  Platform.OS = originalOS;
});

it("reads a blank tag's UID using the iOS tag session and releases it", async () => {
  await expect(startNfcRead("Hold badge").result).resolves.toBe("04AB12CD34EF56");
  expect(NfcManager.requestTechnology).toHaveBeenCalledWith(NfcTech.MifareIOS, {
    alertMessage: "Hold badge",
    skipTagConnect: true,
  });
  expect(NfcManager.cancelTechnologyRequest).toHaveBeenCalledTimes(1);
});

it("uses Android NFC-A reader mode without requiring NDEF", async () => {
  Platform.OS = "android";
  await expect(startNfcRead("Hold badge").result).resolves.toBe("04AB12CD34EF56");
  expect(NfcManager.registerTagEvent).toHaveBeenCalledWith({
    isReaderModeEnabled: true,
    readerModeFlags: 129,
  });
  expect(NfcManager.requestTechnology).toHaveBeenCalledWith(NfcTech.NfcA, {
    alertMessage: "Hold badge",
  });
  expect(NfcManager.unregisterTagEvent).toHaveBeenCalledTimes(1);
});

it.each([
  "unsupported",
  "disabled",
])("reports %s hardware before opening a session", async (condition) => {
  jest
    .mocked(condition === "unsupported" ? NfcManager.isSupported : NfcManager.isEnabled)
    .mockResolvedValue(false);
  await expect(startNfcRead("Hold badge").result).rejects.toThrow(
    condition === "unsupported" ? "scannerNfcUnavailable" : "scannerNfcDisabled",
  );
  expect(NfcManager.requestTechnology).not.toHaveBeenCalled();
});

it("rejects an invalid tag UID and still tears down the reader", async () => {
  jest.mocked(NfcManager.getTag).mockResolvedValue({ id: "1234", ndefMessage: [] });
  await expect(startNfcRead("Hold badge").result).rejects.toThrow("scannerNfcInvalidTag");
  expect(NfcManager.cancelTechnologyRequest).toHaveBeenCalledTimes(1);
});

it("treats the iOS system cancel as a canceled read", async () => {
  jest.mocked(NfcManager.requestTechnology).mockRejectedValue(new NfcError.UserCancel());
  await expect(startNfcRead("Hold badge").result).resolves.toBeNull();
  expect(NfcManager.getTag).not.toHaveBeenCalled();
});

it("does not open a session canceled while support detection is pending", async () => {
  let supported!: (value: boolean) => void;
  jest.mocked(NfcManager.isSupported).mockReturnValue(
    new Promise((resolve) => {
      supported = resolve;
    }),
  );
  const session = startNfcRead("Hold badge");
  await new Promise((resolve) => setTimeout(resolve, 0));
  session.cancel();
  supported(true);
  await expect(session.result).resolves.toBeNull();
  expect(NfcManager.requestTechnology).not.toHaveBeenCalled();
});

it("serializes a reopened reader behind the previous native teardown", async () => {
  let released!: () => void;
  jest.mocked(NfcManager.cancelTechnologyRequest).mockReturnValueOnce(
    new Promise((resolve) => {
      released = resolve;
    }),
  );
  const first = startNfcRead("First");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = startNfcRead("Second");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(NfcManager.requestTechnology).toHaveBeenCalledTimes(1);
  released();
  await first.result;
  await second.result;
  expect(NfcManager.requestTechnology).toHaveBeenCalledTimes(2);
});
