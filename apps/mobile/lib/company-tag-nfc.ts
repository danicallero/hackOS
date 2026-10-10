import { Platform } from "react-native";
import NfcManager, {
  Ndef,
  type NdefRecord,
  NdefStatus,
  NfcError,
  NfcEvents,
  NfcTech,
} from "react-native-nfc-manager";
import { EVENT_WEBSITE_URL } from "@/lib/env";
import { claimPackageName } from "@/lib/nfc-badge-claim";
import { runExclusiveNfcSession } from "@/lib/nfc-reader";
import { normalizeNfcUid } from "@/lib/nfc-uid";

/**
 * Company tags (#935). Staff link an NFC tag or wristband to a company by its
 * serial number (the UID) and, in the same tap, write an NDEF message so that
 * tapping the tag with any phone opens hackOS by itself:
 *
 * 1. a URI record `https://<event host>/s/<UID>`, the company-tag link. iOS
 *    opens it as a universal link (applinks on the event host) and Android as
 *    a verified app link; without the app it opens the web fallback;
 * 2. an Android Application Record with the app's package, so Android starts
 *    hackOS directly even before the link is verified.
 *
 * The link carries the tag's own UID, so it resolves to exactly that tag, and
 * the API applies the same rules as a scanned UID. Writing never comes before
 * the API accepted the link (a wristband that is someone's badge is refused
 * untouched), never overwrites other data without asking, skips read-only
 * tags (linking by serial still works), and is verified by reading it back.
 */

export function companyTagUrl(code: string): string {
  return `${EVENT_WEBSITE_URL.replace(/\/+$/, "")}/s/${encodeURIComponent(code)}`;
}

export function companyTagMessage(code: string, packageName: string): number[] {
  return Ndef.encodeMessage([
    Ndef.uriRecord(companyTagUrl(code)),
    Ndef.androidApplicationRecord(packageName),
  ]);
}

function sameBytes(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * What the tag holds now: nothing worth keeping (no records, or only the
 * badge-claim AAR this app writes), exactly our message, or other data that
 * needs the staff member's confirmation before it is replaced.
 */
export function existingContent(
  records: NdefRecord[] | null | undefined,
  expected: number[],
  packageName: string,
): "empty" | "ours" | "foreign" {
  if (!records || records.length === 0) return "empty";
  if (sameBytes(Ndef.encodeMessage(records), expected)) return "ours";
  const onlyClaim =
    records.length === 1 &&
    Ndef.isType(records[0] as NdefRecord, 0x04, "android.com:pkg") &&
    String.fromCharCode(...((records[0] as NdefRecord).payload as number[])) === packageName;
  return onlyClaim ? "empty" : "foreign";
}

export type CompanyTagWrite =
  /** The link and app record are on the tag and were read back. */
  | "written"
  /** The tag already held exactly this message. */
  | "already"
  /** Locked or not NDEF-capable: linked by serial only. */
  | "readOnly"
  /** The tag holds other data; ask before replacing it (second tap). */
  | "needsOverwrite"
  /** The write or its verification failed; linked by serial only. */
  | "failed"
  /** A second tap met a different tag; nothing was written. */
  | "wrongTag";

export interface CompanyTagSessionOptions {
  /** Shown in the iOS NFC sheet (Android shows the screen's own prompt). */
  prompt: string;
  /** Called with the UID before anything is written; throwing aborts the write. */
  link?: (uid: string) => Promise<void>;
  /** Second tap after a confirmation: the tag that must be presented again. */
  expectedUid?: string;
  /** Replace other existing NDEF data (only after the staff member confirmed). */
  overwrite?: boolean;
}

export interface CompanyTagSession {
  /** `null` when cancelled. Rejects with the NFC error or the `link` error. */
  result: Promise<{ uid: string; write: CompanyTagWrite } | null>;
  cancel: () => void;
}

async function writeMessage(uid: string, overwrite: boolean): Promise<CompanyTagWrite> {
  const packageName = claimPackageName();
  const expected = companyTagMessage(uid, packageName);
  let status: { status: NdefStatus; capacity: number };
  try {
    status = await NfcManager.ndefHandler.getNdefStatus();
  } catch {
    return "readOnly";
  }
  if (status.status !== NdefStatus.ReadWrite) return "readOnly";
  if (status.capacity > 0 && status.capacity < expected.length) return "failed";
  let current: Awaited<ReturnType<typeof NfcManager.ndefHandler.getNdefMessage>>;
  try {
    current = await NfcManager.ndefHandler.getNdefMessage();
  } catch {
    // #935: unreadable content is not evidence that the tag is empty.
    return "failed";
  }
  const content = existingContent(current?.ndefMessage, expected, packageName);
  if (content === "ours") return "already";
  if (content === "foreign" && !overwrite) return "needsOverwrite";
  try {
    await NfcManager.ndefHandler.writeNdefMessage(expected);
    const written = await NfcManager.ndefHandler.getNdefMessage();
    const records = written?.ndefMessage ?? [];
    return records.length > 0 && sameBytes(Ndef.encodeMessage(records), expected)
      ? "written"
      : "failed";
  } catch {
    return "failed";
  }
}

/** One tap: read the UID, link it, then write and verify the NDEF message. */
export function startCompanyTagSession(options: CompanyTagSessionOptions): CompanyTagSession {
  let cancelled = false;
  let requested = false;
  const result = runExclusiveNfcSession(async () => {
    if (!(await NfcManager.isSupported())) throw new Error("scannerNfcUnavailable");
    await NfcManager.start();
    if (!(await NfcManager.isEnabled())) throw new Error("scannerNfcDisabled");
    if (cancelled) return null;
    let sessionClosed: Promise<void> | null = null;
    let waitForClose = false;
    if (Platform.OS === "ios") {
      sessionClosed = new Promise((resolve) => {
        NfcManager.setEventListener(NfcEvents.SessionClosed, () => resolve());
      });
    }
    try {
      requested = true;
      try {
        // iOS: a tag-reader session exposes the UID and NDEF on NTAG chips.
        // Android: NDEF-formatted tags, or any NFC-A tag (read-only path).
        await NfcManager.requestTechnology(
          Platform.OS === "ios" ? NfcTech.MifareIOS : [NfcTech.Ndef, NfcTech.NfcA],
          { alertMessage: options.prompt },
        );
        waitForClose = true;
      } catch (error) {
        if (cancelled || error instanceof NfcError.UserCancel) {
          waitForClose = true;
          return null;
        }
        throw error;
      }
      if (cancelled) return null;
      const tag = await NfcManager.getTag();
      const uid = normalizeNfcUid(tag?.id);
      if (options.expectedUid && uid !== options.expectedUid)
        return { uid, write: "wrongTag" as const };
      if (options.link) await options.link(uid);
      if (cancelled) return null;
      const write = await writeMessage(uid, options.overwrite === true);
      return { uid, write };
    } finally {
      if (requested) await NfcManager.cancelTechnologyRequest().catch(() => undefined);
      // #935: do not let the next scanner race Core NFC sheet invalidation.
      if (sessionClosed) {
        if (waitForClose) await sessionClosed;
        NfcManager.setEventListener(NfcEvents.SessionClosed, null);
      }
    }
  });
  return {
    result,
    cancel: () => {
      cancelled = true;
      if (requested) void NfcManager.cancelTechnologyRequest().catch(() => undefined);
    },
  };
}
