import { Platform } from "react-native";
import NfcManager, { NfcError, NfcEvents, NfcTech, type TagEvent } from "react-native-nfc-manager";
import { setNfcShield, startNfcRead } from "./nfc-reader";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { android: { package: "com.hackudc.os.debug" } } },
}));

jest.mock("react-native-nfc-manager", () => ({
  __esModule: true,
  default: {
    setEventListener: jest.fn(),
    isSupported: jest.fn(),
    start: jest.fn(),
    isEnabled: jest.fn(),
    registerTagEvent: jest.fn(),
    unregisterTagEvent: jest.fn(),
    requestTechnology: jest.fn(),
    getTag: jest.fn(),
    cancelTechnologyRequest: jest.fn(),
    sendMifareCommandIOS: jest.fn(),
    mifareUltralightHandlerAndroid: {
      mifareUltralightReadPages: jest.fn(),
      mifareUltralightWritePage: jest.fn(),
    },
  },
  NfcEvents: { DiscoverTag: "discover", SessionClosed: "closed" },
  NfcTech: { MifareIOS: "mifare", NfcA: "NfcA", MifareUltralight: "MifareUltralight" },
  NfcAdapter: { FLAG_READER_NFC_A: 1, FLAG_READER_SKIP_NDEF_CHECK: 128 },
  NfcError: { UserCancel: class UserCancel extends Error {} },
}));

function androidTagListener() {
  const call = jest
    .mocked(NfcManager.setEventListener)
    .mock.calls.find(([event, listener]) => event === NfcEvents.DiscoverTag && listener !== null);
  return call?.[1] as ((tag: TagEvent) => void) | undefined;
}

function closeIosSession() {
  const call = jest
    .mocked(NfcManager.setEventListener)
    .mock.calls.slice()
    .reverse()
    .find(([event, listener]) => event === NfcEvents.SessionClosed && listener !== null);
  (call?.[1] as (() => void) | undefined)?.();
}

const originalOS = Platform.OS;
beforeEach(() => {
  jest.resetAllMocks();
  Platform.OS = "ios";
  jest.mocked(NfcManager.cancelTechnologyRequest).mockImplementation(async () => closeIosSession());
  jest.mocked(NfcManager.registerTagEvent).mockImplementation(async () => {
    androidTagListener()?.({ id: "04:ab:12:cd:34:ef:56", ndefMessage: [] });
  });
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
  expect(NfcManager.requestTechnology).not.toHaveBeenCalled();
  expect(NfcManager.getTag).not.toHaveBeenCalled();
  expect(NfcManager.setEventListener).toHaveBeenLastCalledWith(NfcEvents.DiscoverTag, null);
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
  jest.mocked(NfcManager.cancelTechnologyRequest).mockImplementationOnce(async () => {
    await new Promise<void>((resolve) => {
      released = resolve;
    });
    closeIosSession();
  });
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

it("cancels an Android discovery wait and removes the listener", async () => {
  Platform.OS = "android";
  jest.mocked(NfcManager.registerTagEvent).mockResolvedValue(undefined);
  const session = startNfcRead("Hold badge");
  await new Promise((resolve) => setTimeout(resolve, 0));
  session.cancel();
  await expect(session.result).resolves.toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(NfcManager.unregisterTagEvent).toHaveBeenCalledTimes(1);
  expect(NfcManager.setEventListener).toHaveBeenLastCalledWith(NfcEvents.DiscoverTag, null);
});

it("rejects an invalid Android UID and releases reader mode", async () => {
  Platform.OS = "android";
  jest.mocked(NfcManager.registerTagEvent).mockImplementation(async () => {
    androidTagListener()?.({ id: "1234", ndefMessage: [] });
  });
  await expect(startNfcRead("Hold badge").result).rejects.toThrow("scannerNfcInvalidTag");
  expect(NfcManager.unregisterTagEvent).toHaveBeenCalledTimes(1);
});

describe("badge claim (linking only)", () => {
  const ultralight = () => NfcManager.mifareUltralightHandlerAndroid;
  const blankMemory = () => {
    const memory = new Map<number, number[]>();
    const write = async (page: number, data: number[]) => void memory.set(page, data);
    const read = async (page: number) =>
      [0, 1, 2, 3].flatMap((i) => memory.get(page + i) ?? [0, 0, 0, 0]);
    return { memory, write, read };
  };

  it("writes the application record on Android, tail pages first, then releases", async () => {
    Platform.OS = "android";
    const { memory, write, read } = blankMemory();
    const order: number[] = [];
    jest.mocked(ultralight().mifareUltralightWritePage).mockImplementation(async (page, data) => {
      order.push(page);
      await write(page, data);
    });
    jest.mocked(ultralight().mifareUltralightReadPages).mockImplementation(read);
    jest.mocked(NfcManager.requestTechnology).mockResolvedValue(NfcTech.MifareUltralight);
    await expect(startNfcRead("Hold badge", { claimBadge: true }).result).resolves.toBe(
      "04AB12CD34EF56",
    );
    expect(NfcManager.requestTechnology).toHaveBeenCalledWith(NfcTech.MifareUltralight);
    expect(order[order.length - 1]).toBe(4);
    expect(order).toEqual([...order].sort((a, b) => b - a));
    const bytes = [...memory.keys()].sort((a, b) => a - b).flatMap((p) => memory.get(p)!);
    expect(String.fromCharCode(...bytes.slice(5, 20))).toBe("android.com:pkg");
    expect(String.fromCharCode(...bytes.slice(20, 34))).toBe("com.hackudc.os");
    expect(NfcManager.cancelTechnologyRequest).toHaveBeenCalledTimes(1);
    expect(NfcManager.unregisterTagEvent).toHaveBeenCalledTimes(1);
  });

  it("still returns the UID when the Android write fails, and reports it", async () => {
    Platform.OS = "android";
    jest.mocked(NfcManager.requestTechnology).mockResolvedValue(NfcTech.MifareUltralight);
    jest.mocked(ultralight().mifareUltralightWritePage).mockRejectedValue(new Error("lost"));
    const session = startNfcRead("Hold badge", { claimBadge: true });
    await expect(session.result).resolves.toBe("04AB12CD34EF56");
    expect(session.claimFailed()).toBe(true);
    expect(NfcManager.unregisterTagEvent).toHaveBeenCalledTimes(1);
  });

  it("still returns the UID when the iOS write fails", async () => {
    jest.mocked(NfcManager.sendMifareCommandIOS).mockRejectedValue(new Error("nak"));
    const session = startNfcRead("Hold badge", { claimBadge: true });
    await expect(session.result).resolves.toBe("04AB12CD34EF56");
    expect(session.claimFailed()).toBe(true);
  });

  it("reports a claim failure when the Android tag does not offer MIFARE Ultralight", async () => {
    Platform.OS = "android";
    jest.mocked(NfcManager.requestTechnology).mockResolvedValue(null);
    const session = startNfcRead("Hold badge", { claimBadge: true });
    await expect(session.result).resolves.toBe("04AB12CD34EF56");
    expect(session.claimFailed()).toBe(true);
    expect(ultralight().mifareUltralightWritePage).not.toHaveBeenCalled();
  });

  it("reports a claim failure when the written pages do not read back", async () => {
    Platform.OS = "android";
    jest.mocked(NfcManager.requestTechnology).mockResolvedValue(NfcTech.MifareUltralight);
    jest.mocked(ultralight().mifareUltralightWritePage).mockResolvedValue(undefined);
    jest.mocked(ultralight().mifareUltralightReadPages).mockResolvedValue(new Array(16).fill(0));
    const session = startNfcRead("Hold badge", { claimBadge: true });
    await expect(session.result).resolves.toBe("04AB12CD34EF56");
    expect(session.claimFailed()).toBe(true);
  });

  it("writes through raw MIFARE commands on iOS with a connected session", async () => {
    const { write, read } = blankMemory();
    jest
      .mocked(NfcManager.sendMifareCommandIOS)
      .mockImplementation(async ([cmd, page, ...data]) => {
        if (cmd === 0xa2) await write(page!, data);
        else return read(page!);
        return [];
      });
    await expect(startNfcRead("Hold badge", { claimBadge: true }).result).resolves.toBe(
      "04AB12CD34EF56",
    );
    expect(NfcManager.requestTechnology).toHaveBeenCalledWith(NfcTech.MifareIOS, {
      alertMessage: "Hold badge",
      skipTagConnect: false,
    });
    const writes = jest
      .mocked(NfcManager.sendMifareCommandIOS)
      .mock.calls.filter(([bytes]) => bytes[0] === 0xa2);
    expect(writes.length).toBeGreaterThan(0);
    expect(writes[writes.length - 1]![0][1]).toBe(4);
  });

  it("never writes when only reading", async () => {
    await startNfcRead("Hold badge").result;
    Platform.OS = "android";
    await startNfcRead("Hold badge").result;
    expect(NfcManager.sendMifareCommandIOS).not.toHaveBeenCalled();
    expect(ultralight().mifareUltralightWritePage).not.toHaveBeenCalled();
  });
});

describe("Android idle shield", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("keeps reader mode registered without a listener, and releases it", async () => {
    Platform.OS = "android";
    setNfcShield(true);
    await flush();
    expect(NfcManager.registerTagEvent).toHaveBeenCalledWith({
      isReaderModeEnabled: true,
      readerModeFlags: 129,
    });
    expect(NfcManager.setEventListener).not.toHaveBeenCalled();
    setNfcShield(false);
    await flush();
    expect(NfcManager.unregisterTagEvent).toHaveBeenCalledTimes(1);
  });

  it("is restored after a scan tears its own registration down", async () => {
    Platform.OS = "android";
    setNfcShield(true);
    await flush();
    await startNfcRead("Hold badge").result;
    await flush();
    const registers = jest.mocked(NfcManager.registerTagEvent).mock.calls.length;
    const unregisters = jest.mocked(NfcManager.unregisterTagEvent).mock.calls.length;
    expect(registers).toBe(3);
    expect(unregisters).toBe(1);
    setNfcShield(false);
    await flush();
  });

  it("does nothing on iOS", async () => {
    setNfcShield(true);
    await flush();
    expect(NfcManager.registerTagEvent).not.toHaveBeenCalled();
  });
});
