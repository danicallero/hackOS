/** H22–H26: persist the seven-byte hardware UID, never an NDEF payload. */
export function normalizeNfcUid(id: string | undefined): string {
  const uid = (id ?? "").replace(/[:\s-]/g, "").toUpperCase();
  if (!/^[0-9A-F]{14}$/.test(uid)) throw new Error("scannerNfcInvalidTag");
  return uid;
}
