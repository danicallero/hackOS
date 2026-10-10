import { Platform } from "react-native";
import NfcManager, { Ndef } from "react-native-nfc-manager";
import {
  companyTagMessage,
  companyTagUrl,
  existingContent,
  startCompanyTagSession,
} from "./company-tag-nfc";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { android: { package: "com.hackudc.os.debug" } } },
}));
jest.mock("@/lib/env", () => ({ EVENT_WEBSITE_URL: "https://os.hackudc.com/" }));
jest.mock("@/lib/nfc-reader", () => ({
  runExclusiveNfcSession: <T>(task: () => Promise<T>) => task(),
}));
jest.mock("react-native-nfc-manager", () => ({
  __esModule: true,
  // The NDEF encoder is plain JavaScript; only the native bridge is mocked.
  Ndef: jest.requireActual("react-native-nfc-manager/ndef-lib"),
  NdefStatus: { NotSupported: 1, ReadWrite: 2, ReadOnly: 3 },
  NfcTech: { Ndef: "Ndef", NfcA: "NfcA", MifareIOS: "mifare" },
  NfcError: { UserCancel: class UserCancel extends Error {} },
  NfcEvents: { SessionClosed: "closed" },
  default: {
    isSupported: jest.fn(),
    start: jest.fn(),
    isEnabled: jest.fn(),
    requestTechnology: jest.fn(),
    getTag: jest.fn(),
    cancelTechnologyRequest: jest.fn(),
    setEventListener: jest.fn(),
    ndefHandler: {
      getNdefStatus: jest.fn(),
      getNdefMessage: jest.fn(),
      writeNdefMessage: jest.fn(),
    },
  },
}));

const nfc = jest.mocked(NfcManager);
const ndef = nfc.ndefHandler as jest.Mocked<typeof NfcManager.ndefHandler>;
const UID = "04A1B2C3D4E5F6";
const PACKAGE = "com.hackudc.os";
const originalOS = Platform.OS;

/** A tag whose NDEF content is what the last write put there. */
function tagHolding(initial: number[] | null) {
  let bytes = initial;
  ndef.getNdefMessage.mockImplementation(async () =>
    bytes ? { ndefMessage: Ndef.decodeMessage(bytes) } : null,
  );
  ndef.writeNdefMessage.mockImplementation(async (next) => {
    bytes = next;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  Platform.OS = "android";
  nfc.isSupported.mockResolvedValue(true);
  nfc.start.mockResolvedValue(undefined);
  nfc.isEnabled.mockResolvedValue(true);
  nfc.requestTechnology.mockResolvedValue("Ndef" as never);
  nfc.getTag.mockResolvedValue({ id: "04a1b2c3d4e5f6", ndefMessage: [] });
  nfc.cancelTechnologyRequest.mockResolvedValue(undefined);
  nfc.setEventListener.mockImplementation((_event, listener) => {
    if (listener)
      nfc.cancelTechnologyRequest.mockImplementation(async () => {
        listener({} as never);
      });
  });
  ndef.getNdefStatus.mockResolvedValue({ status: 2, capacity: 137 });
  tagHolding(null);
});
afterEach(() => {
  Platform.OS = originalOS;
});

describe("company tag NDEF message (#935)", () => {
  it("is the tag link on the event host plus the release app record", () => {
    expect(companyTagUrl(UID)).toBe("https://os.hackudc.com/s/04A1B2C3D4E5F6");
    const records = Ndef.decodeMessage(companyTagMessage(UID, PACKAGE));
    expect(records).toHaveLength(2);
    expect(Ndef.uri.decodePayload(Uint8Array.from(records[0]!.payload))).toBe(
      "https://os.hackudc.com/s/04A1B2C3D4E5F6",
    );
    expect(Ndef.isType(records[1]!, 0x04, "android.com:pkg")).toBe(true);
    expect(String.fromCharCode(...(records[1]!.payload as number[]))).toBe(PACKAGE);
  });

  it("treats a blank tag or the badge claim record as empty, anything else as foreign", () => {
    const expected = companyTagMessage(UID, PACKAGE);
    expect(existingContent([], expected, PACKAGE)).toBe("empty");
    expect(existingContent([Ndef.androidApplicationRecord(PACKAGE)], expected, PACKAGE)).toBe(
      "empty",
    );
    expect(existingContent(Ndef.decodeMessage(expected), expected, PACKAGE)).toBe("ours");
    expect(existingContent([Ndef.uriRecord("https://example.com")], expected, PACKAGE)).toBe(
      "foreign",
    );
  });
});

describe("startCompanyTagSession (#935)", () => {
  it("links the serial first, then writes and verifies the link", async () => {
    const order: string[] = [];
    const link = jest.fn(async (uid: string) => {
      order.push(`link:${uid}`);
    });
    ndef.writeNdefMessage.mockImplementationOnce(async (bytes) => {
      order.push("write");
      tagHolding(bytes);
    });
    const result = await startCompanyTagSession({ prompt: "Hold", link }).result;
    expect(result).toEqual({ uid: UID, write: "written" });
    expect(order).toEqual([`link:${UID}`, "write"]);
    expect(Ndef.decodeMessage(ndef.writeNdefMessage.mock.calls[0]![0])).toHaveLength(2);
    expect(nfc.requestTechnology).toHaveBeenCalledWith(["Ndef", "NfcA"], { alertMessage: "Hold" });
    expect(nfc.cancelTechnologyRequest).toHaveBeenCalled();
  });

  it("writes nothing when the API refuses the serial (a wristband that is a badge)", async () => {
    const refused = new Error("This wristband is already a badge");
    await expect(
      startCompanyTagSession({
        prompt: "Hold",
        link: async () => {
          throw refused;
        },
      }).result,
    ).rejects.toBe(refused);
    expect(ndef.writeNdefMessage).not.toHaveBeenCalled();
    expect(nfc.cancelTechnologyRequest).toHaveBeenCalled();
  });

  it("keeps a read-only or locked tag linked by serial and skips the write", async () => {
    ndef.getNdefStatus.mockResolvedValue({ status: 3, capacity: 137 });
    const link = jest.fn().mockResolvedValue(undefined);
    expect(await startCompanyTagSession({ prompt: "Hold", link }).result).toEqual({
      uid: UID,
      write: "readOnly",
    });
    expect(link).toHaveBeenCalledWith(UID);
    expect(ndef.writeNdefMessage).not.toHaveBeenCalled();

    ndef.getNdefStatus.mockRejectedValue(new Error("not NDEF"));
    expect((await startCompanyTagSession({ prompt: "Hold", link }).result)?.write).toBe("readOnly");
  });

  it("asks before replacing other data, and only overwrites the same tag", async () => {
    tagHolding(Ndef.encodeMessage([Ndef.uriRecord("https://example.com/menu")]));
    const link = jest.fn().mockResolvedValue(undefined);
    expect((await startCompanyTagSession({ prompt: "Hold", link }).result)?.write).toBe(
      "needsOverwrite",
    );
    expect(ndef.writeNdefMessage).not.toHaveBeenCalled();

    nfc.getTag.mockResolvedValueOnce({ id: "04FFFFFFFFFFFF", ndefMessage: [] });
    expect(
      await startCompanyTagSession({ prompt: "Again", expectedUid: UID, overwrite: true }).result,
    ).toEqual({ uid: "04FFFFFFFFFFFF", write: "wrongTag" });
    expect(ndef.writeNdefMessage).not.toHaveBeenCalled();

    expect(
      await startCompanyTagSession({ prompt: "Again", expectedUid: UID, overwrite: true }).result,
    ).toEqual({ uid: UID, write: "written" });
    expect(link).toHaveBeenCalledTimes(1);
  });

  it("does not rewrite a tag that already holds the link", async () => {
    tagHolding(companyTagMessage(UID, PACKAGE));
    expect((await startCompanyTagSession({ prompt: "Hold" }).result)?.write).toBe("already");
    expect(ndef.writeNdefMessage).not.toHaveBeenCalled();
  });

  it("reports a write that does not read back", async () => {
    ndef.writeNdefMessage.mockResolvedValue(undefined);
    ndef.getNdefMessage.mockResolvedValue(null);
    expect((await startCompanyTagSession({ prompt: "Hold" }).result)?.write).toBe("failed");
  });

  it("does not overwrite data when reading existing records fails", async () => {
    ndef.getNdefMessage.mockRejectedValue(new Error("read failed"));
    expect((await startCompanyTagSession({ prompt: "Hold" }).result)?.write).toBe("failed");
    expect(ndef.writeNdefMessage).not.toHaveBeenCalled();
  });

  it("does not write after cancellation while the API links the serial", async () => {
    let finishLink!: () => void;
    let linked!: () => void;
    const linking = new Promise<void>((resolve) => {
      linked = resolve;
    });
    const session = startCompanyTagSession({
      prompt: "Hold",
      link: () => {
        linked();
        return new Promise<void>((resolve) => {
          finishLink = resolve;
        });
      },
    });
    await linking;
    session.cancel();
    finishLink();
    expect(await session.result).toBeNull();
    expect(ndef.writeNdefMessage).not.toHaveBeenCalled();
  });

  it("uses a tag-reader session on iOS and resolves null when cancelled", async () => {
    Platform.OS = "ios";
    const { NfcError } = jest.requireMock("react-native-nfc-manager");
    nfc.requestTechnology.mockRejectedValue(new NfcError.UserCancel());
    expect(await startCompanyTagSession({ prompt: "Hold" }).result).toBeNull();
    expect(nfc.requestTechnology).toHaveBeenCalledWith("mifare", { alertMessage: "Hold" });
  });

  it("explains a phone without NFC", async () => {
    nfc.isSupported.mockResolvedValue(false);
    await expect(startCompanyTagSession({ prompt: "Hold" }).result).rejects.toThrow(
      "scannerNfcUnavailable",
    );
  });
});
