import { assertOkResponse } from "../channels/http.js";

/**
 * Self-hosted LibreTranslate adapter (H50 alternative to Google Translate).
 * LibreTranslate accepts `q` as an array for batch translation. Exercised in
 * tests via a stubbed `global.fetch`, never a live network call — same
 * convention as the Resend email adapter (channels/email-adapters/resend.ts).
 */
export async function translateViaLibreTranslate(
  texts: string[],
  target: string,
  source: string,
  url: string,
  apiKey?: string,
): Promise<string[]> {
  const res = await fetch(`${url.replace(/\/$/, "")}/translate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ q: texts, target, source, format: "text", api_key: apiKey }),
  });
  await assertOkResponse(res, "LibreTranslate");
  const body = (await res.json()) as { translatedText: string | string[] };
  return Array.isArray(body.translatedText) ? body.translatedText : [body.translatedText];
}
