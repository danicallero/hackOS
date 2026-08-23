import { assertOkResponse } from "../channels/http.js";
import type { TranslateFn } from "./index.js";

/**
 * Google Cloud Translation v2 REST adapter. Exercised in tests via a
 * stubbed `global.fetch`, never a live network call — same convention as
 * the Resend email adapter (channels/email-adapters/resend.ts).
 */
export const translateViaGoogle: TranslateFn = async (texts, target, source, apiKey) => {
  const res = await fetch(
    `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: texts, target, source, format: "text" }),
    },
  );
  await assertOkResponse(res, "Google Translate");
  const body = (await res.json()) as {
    data: { translations: { translatedText: string }[] };
  };
  return body.data.translations.map((t) => t.translatedText);
};
