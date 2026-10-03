import { normalizeNfcUid } from "./nfc-uid";

it.each([
  "04AB12CD34EF56",
  "04:ab:12:cd:34:ef:56",
  "04 ab 12 cd 34 ef 56",
  "04-ab-12-cd-34-ef-56",
])("normalizes the same seven-byte UID: %s", (uid) => {
  expect(normalizeNfcUid(uid)).toBe("04AB12CD34EF56");
});
it.each([
  undefined,
  "",
  "1234",
  "04GG12CD34EF56",
  "04AB12CD34EF5600",
])("rejects missing or malformed UIDs: %s", (uid) => {
  expect(() => normalizeNfcUid(uid)).toThrow("scannerNfcInvalidTag");
});
