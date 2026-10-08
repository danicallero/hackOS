import { Platform } from "react-native";
import NfcManager, {
  NfcAdapter,
  NfcError,
  NfcEvents,
  NfcTech,
  type TagEvent,
} from "react-native-nfc-manager";
import { normalizeNfcUid } from "@/lib/nfc-uid";

// H22–H26: Core NFC owns one session; wait for native invalidation before another starts.
let previousSession: Promise<void> = Promise.resolve();

export function startNfcRead(message: string) {
  let cancelled = false;
  let requested = false;
  let registered = false;
  let resolveAndroidTag: ((tag: TagEvent | null) => void) | null = null;
  let cancelRequest: Promise<void> | null = null;
  let resolveResult!: (uid: string | null) => void;
  let rejectResult!: (error: unknown) => void;
  const cancelNativeRequest = () => {
    if (!requested) return Promise.resolve();
    cancelRequest ??= NfcManager.cancelTechnologyRequest();
    return cancelRequest;
  };
  const result = new Promise<string | null>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const completion = previousSession
    .catch(() => undefined)
    .then(async () => {
      if (cancelled) {
        resolveResult(null);
        return;
      }
      let sessionClose: Promise<void> | null = null;
      let waitForSessionClose = false;
      let resolveSessionClose!: () => void;
      try {
        if (!(await NfcManager.isSupported())) throw new Error("scannerNfcUnavailable");
        if (cancelled) {
          resolveResult(null);
          return;
        }
        await NfcManager.start();
        if (!(await NfcManager.isEnabled())) throw new Error("scannerNfcDisabled");
        if (cancelled) {
          resolveResult(null);
          return;
        }
        if (Platform.OS === "android") {
          // H22–H26: the discovery event already contains the UID. Connecting
          // to NfcA adds an unnecessary hardware-dependent failure and can miss
          // a tag discovered before requestTechnology has installed its callback.
          const discoveredTag = new Promise<TagEvent | null>((resolve) => {
            resolveAndroidTag = resolve;
          });
          NfcManager.setEventListener(NfcEvents.DiscoverTag, (tag: TagEvent) => {
            resolveAndroidTag?.(tag);
          });
          await NfcManager.registerTagEvent({
            isReaderModeEnabled: true,
            readerModeFlags: NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK,
          });
          registered = true;
          const tag = cancelled ? null : await discoveredTag;
          resolveResult(cancelled || !tag ? null : normalizeNfcUid(tag.id));
          return;
        }
        if (Platform.OS === "ios" && typeof NfcManager.setEventListener === "function") {
          sessionClose = new Promise((resolve) => {
            resolveSessionClose = resolve;
          });
          NfcManager.setEventListener(NfcEvents.SessionClosed, () => resolveSessionClose());
        }
        requested = true;
        try {
          await NfcManager.requestTechnology(
            Platform.OS === "ios" ? NfcTech.MifareIOS : NfcTech.NfcA,
            {
              alertMessage: message,
              ...(Platform.OS === "ios" ? { skipTagConnect: true } : {}),
            },
          );
          waitForSessionClose = true;
        } catch (error) {
          waitForSessionClose = true;
          if (cancelled || error instanceof NfcError.UserCancel) {
            resolveResult(null);
            return;
          }
          throw error;
        }
        waitForSessionClose = true;
        if (cancelled) {
          resolveResult(null);
          return;
        }
        const tag = await NfcManager.getTag();
        // Resolve the scan as soon as its UID is available. Teardown continues
        // below, while the next read remains queued until iOS reports that its
        // Core NFC sheet has actually closed.
        resolveResult(cancelled ? null : normalizeNfcUid(tag?.id));
      } catch (error) {
        if (cancelled || error instanceof NfcError.UserCancel) resolveResult(null);
        else rejectResult(error);
      } finally {
        if (requested) await cancelNativeRequest();
        requested = false;
        if (Platform.OS === "android" && resolveAndroidTag) {
          NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
          resolveAndroidTag = null;
        }
        if (registered) await NfcManager.unregisterTagEvent();
        registered = false;
        if (sessionClose) {
          if (waitForSessionClose) await sessionClose;
          NfcManager.setEventListener(NfcEvents.SessionClosed, null);
        }
      }
    });
  previousSession = completion.catch(() => undefined);
  return {
    result,
    cancel: () => {
      cancelled = true;
      resolveAndroidTag?.(null);
      if (requested) void cancelNativeRequest();
    },
  };
}
