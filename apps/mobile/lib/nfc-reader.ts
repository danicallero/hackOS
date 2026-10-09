import { Platform } from "react-native";
import NfcManager, {
  NfcAdapter,
  NfcError,
  NfcEvents,
  NfcTech,
  type TagEvent,
} from "react-native-nfc-manager";
import { claimPackageName, type TagPageIo, writeBadgeClaim } from "@/lib/nfc-badge-claim";
import { normalizeNfcUid } from "@/lib/nfc-uid";

// H22–H26: Core NFC owns one session; wait for native invalidation before another starts.
let previousSession: Promise<void> = Promise.resolve();

// H22–H26: while hackOS is in the foreground on Android, NFC-A reader mode stays
// registered (with no listener, so tags are ignored) between scans. Reader mode
// bypasses the system tag dispatch, so a badge tapped outside a scan never
// raises the "New tag" screen nor starts another activity. Scans take over the
// registration and hand it back when they finish.
const READER_MODE = {
  isReaderModeEnabled: true,
  readerModeFlags: NfcAdapter.FLAG_READER_NFC_A | NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK,
};
let shieldWanted = false;
let shieldActive = false;

async function syncShield() {
  if (Platform.OS !== "android") return;
  try {
    if (shieldWanted && !shieldActive) {
      if (!(await NfcManager.isSupported())) return;
      await NfcManager.start();
      if (!(await NfcManager.isEnabled())) return;
      await NfcManager.registerTagEvent(READER_MODE);
      shieldActive = true;
    } else if (!shieldWanted && shieldActive) {
      shieldActive = false;
      await NfcManager.unregisterTagEvent();
    }
  } catch {
    // Best effort: without the shield Android falls back to the tag-claim filter.
    shieldActive = false;
  }
}

export function setNfcShield(wanted: boolean) {
  if (Platform.OS !== "android") return;
  shieldWanted = wanted;
  const run = previousSession.catch(() => undefined).then(syncShield);
  previousSession = run;
}

const androidPageIo: TagPageIo = {
  readPages: (page) => NfcManager.mifareUltralightHandlerAndroid.mifareUltralightReadPages(page),
  writePage: (page, data) =>
    NfcManager.mifareUltralightHandlerAndroid.mifareUltralightWritePage(page, data),
};

const iosPageIo: TagPageIo = {
  readPages: (page) => NfcManager.sendMifareCommandIOS([0x30, page]),
  writePage: async (page, data) => {
    await NfcManager.sendMifareCommandIOS([0xa2, page, ...data]);
  },
};

/**
 * `claimBadge` is only for linking a badge (H22/H23): after the UID is read the
 * tag also gets the NDEF application record from `nfc-badge-claim.ts`. A failed
 * write never fails the read; it is reported through `claimFailed()`.
 */
export function startNfcRead(message: string, { claimBadge = false } = {}) {
  let cancelled = false;
  let claimFailed = false;
  let requested = false;
  let registered = false;
  let resolveAndroidTag: ((tag: TagEvent | null) => void) | null = null;
  let cancelRequest: Promise<void> | null = null;
  let resolveResult!: (uid: string | null) => void;
  let rejectResult!: (error: unknown) => void;
  // The tag write is best effort: the badge is linked by its UID either way and
  // the caller is told when the tag could not be prepared.
  const claim = async (write: () => Promise<void>) => {
    try {
      await write();
    } catch {
      claimFailed = true;
    }
  };
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
          // This registration replaces the idle shield and its teardown ends it.
          shieldActive = false;
          await NfcManager.registerTagEvent(READER_MODE);
          registered = true;
          // The request is installed before the tag arrives so reader mode
          // connects to it on discovery; it is only needed to write the claim.
          const connected = claimBadge
            ? NfcManager.requestTechnology(NfcTech.MifareUltralight).then(
                (tech) => ({ tech }),
                (error: unknown) => ({ error }),
              )
            : null;
          requested = connected !== null;
          const tag = cancelled ? null : await discoveredTag;
          const uid = cancelled || !tag ? null : normalizeNfcUid(tag.id);
          if (uid && connected) {
            const outcome = await connected;
            if (cancelled) {
              resolveResult(null);
              return;
            }
            await claim(async () => {
              if ("error" in outcome || !outcome.tech) throw new Error("scannerNfcWriteFailed");
              await writeBadgeClaim(androidPageIo, claimPackageName());
            });
          }
          resolveResult(uid);
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
              ...(Platform.OS === "ios" ? { skipTagConnect: !claimBadge } : {}),
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
        const uid = normalizeNfcUid(tag?.id);
        if (claimBadge && !cancelled) {
          await claim(() => writeBadgeClaim(iosPageIo, claimPackageName()));
        }
        // Resolve the scan as soon as its UID is available. Teardown continues
        // below, while the next read remains queued until iOS reports that its
        // Core NFC sheet has actually closed.
        resolveResult(cancelled ? null : uid);
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
        await syncShield();
        if (sessionClose) {
          if (waitForSessionClose) await sessionClose;
          NfcManager.setEventListener(NfcEvents.SessionClosed, null);
        }
      }
    });
  previousSession = completion.catch(() => undefined);
  return {
    result,
    claimFailed: () => claimFailed,
    cancel: () => {
      cancelled = true;
      resolveAndroidTag?.(null);
      if (requested) void cancelNativeRequest();
    },
  };
}
