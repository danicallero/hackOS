import Constants from "expo-constants";

// H22–H26: NTAG213 badges ship with an NDEF Capability Container (page 3, OTP,
// not erasable) and no records, so Pixel phones show the system "New tag /
// Tag empty" screen. When a badge is linked we write a one-record NDEF message
// holding only an Android Application Record (AAR) so Android hands the tag to
// this app instead. No attendee data is written, and nothing is ever locked.
const FIRST_USER_PAGE = 4;
const AAR_TYPE = "android.com:pkg";

export interface TagPageIo {
  /** Reads four consecutive pages (16 bytes) starting at `page`. */
  readPages(page: number): Promise<ArrayLike<number>>;
  writePage(page: number, data: number[]): Promise<void>;
}

/** Android package of the release app; debug builds claim the release package. */
export function claimPackageName(): string {
  const id = Constants.expoConfig?.android?.package;
  if (!id) throw new Error("scannerNfcWriteFailed");
  return id.replace(/\.debug$/, "");
}

const ascii = (value: string) => Array.from(value, (char) => char.charCodeAt(0));

/** NDEF TLV (message + terminator) split into four-byte pages from page 4. */
export function buildClaimPages(packageName: string): number[][] {
  const type = ascii(AAR_TYPE);
  const payload = ascii(packageName);
  // MB|ME|SR, TNF = external type.
  const record = [0xd4, type.length, payload.length, ...type, ...payload];
  const tlv = [0x03, record.length, ...record, 0xfe];
  while (tlv.length % 4 !== 0) tlv.push(0);
  const pages: number[][] = [];
  for (let i = 0; i < tlv.length; i += 4) pages.push(tlv.slice(i, i + 4));
  return pages;
}

/**
 * Writes the claim message. The first page, which holds the TLV header, goes
 * last so an interrupted write leaves the tag exactly as blank as before.
 */
export async function writeBadgeClaim(io: TagPageIo, packageName: string): Promise<void> {
  const pages = buildClaimPages(packageName);
  for (let i = pages.length - 1; i >= 0; i--) {
    await io.writePage(FIRST_USER_PAGE + i, pages[i]!);
  }
  for (let i = 0; i < pages.length; i += 4) {
    const read = await io.readPages(FIRST_USER_PAGE + i);
    pages.slice(i, i + 4).forEach((page, offset) => {
      if (page.some((byte, index) => read[offset * 4 + index] !== byte)) {
        throw new Error("scannerNfcWriteFailed");
      }
    });
  }
}
