import { AsYouType, type CountryCode, parsePhoneNumberFromString } from "libphonenumber-js/min";

/** Country assumed for numbers typed without an international prefix. */
export const DEFAULT_PHONE_COUNTRY: CountryCode = "ES";

/**
 * Canonical E.164 form (`+34600111222`) of a phone number that is plausible for
 * its country, or `null`. Format-only: the number is never verified (#phone).
 */
export function normalizePhone(
  raw: string,
  country: CountryCode = DEFAULT_PHONE_COUNTRY,
): string | null {
  const parsed = parsePhoneNumberFromString(raw.trim(), country);
  return parsed?.isValid() ? parsed.number : null;
}

/** Display form that follows the typed digits (`+34 600 11 12 22`). */
export function formatPhoneAsYouType(
  raw: string,
  country: CountryCode = DEFAULT_PHONE_COUNTRY,
): string {
  return new AsYouType(country).input(raw);
}

/** Readable international form of a valid number; the input otherwise. */
export function formatPhoneInternational(raw: string): string {
  return parsePhoneNumberFromString(raw)?.formatInternational() ?? raw;
}
