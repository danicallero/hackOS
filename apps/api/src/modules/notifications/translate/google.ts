import { assertOkResponse } from "../channels/http.js";

/**
 * Google Cloud Translation v2 REST adapter. Exercised in tests via a
 * stubbed `global.fetch`, never a live network call — same convention as
 * the Resend email adapter (channels/email-adapters/resend.ts).
 */
export async function translateViaGoogle(
  texts: string[],
  target: string,
  source: string,
  apiKey: string,
): Promise<string[]> {
  // Google's v2 API auto-detects the source language when the field is
  // omitted entirely — "auto" is not a valid value for it, unlike LibreTranslate.
  const requestBody: Record<string, unknown> = { q: texts, target, format: "text" };
  if (source !== "auto") requestBody.source = source;
  const res = await fetch(
    `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    },
  );
  await assertOkResponse(res, "Google Translate");
  const body = (await res.json()) as {
    data: { translations: { translatedText: string }[] };
  };
  return body.data.translations.map((t) => t.translatedText);
}
