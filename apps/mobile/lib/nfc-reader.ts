import { Platform } from "react-native";
import NfcManager, { NfcAdapter, NfcError, NfcTech } from "react-native-nfc-manager";
import { normalizeNfcUid } from "@/lib/nfc-uid";

// H22–H26: Core NFC owns one session; wait for teardown before another reader starts.
let previousSession: Promise<unknown> = Promise.resolve();

export function startNfcRead(message: string) {
  let cancelled = false;
  let requested = false;
  let registered = false;
  const result = previousSession
    .catch(() => undefined)
    .then(async () => {
      if (cancelled) return null;
      try {
        if (!(await NfcManager.isSupported())) throw new Error("scannerNfcUnavailable");
        if (cancelled) return null;
        await NfcManager.start();
        if (!(await NfcManager.isEnabled())) throw new Error("scannerNfcDisabled");
        if (cancelled) return null;
        if (Platform.OS === "android") {
          await NfcManager.registerTagEvent({
            isReaderModeEnabled: true,
            readerModeFlags: NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK,
          });
          registered = true;
          if (cancelled) return null;
        }
        requested = true;
        await NfcManager.requestTechnology(
          Platform.OS === "ios" ? NfcTech.MifareIOS : NfcTech.NfcA,
          { alertMessage: message },
        );
        if (cancelled) return null;
        const tag = await NfcManager.getTag();
        return cancelled ? null : normalizeNfcUid(tag?.id);
      } catch (error) {
        if (cancelled || error instanceof NfcError.UserCancel) return null;
        throw error;
      } finally {
        if (requested) await NfcManager.cancelTechnologyRequest();
        requested = false;
        if (registered) await NfcManager.unregisterTagEvent();
        registered = false;
      }
    });
  previousSession = result;
  return {
    result,
    cancel: () => {
      cancelled = true;
      if (requested) void NfcManager.cancelTechnologyRequest();
    },
  };
}
