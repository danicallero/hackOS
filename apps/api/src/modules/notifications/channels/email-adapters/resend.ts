import type { MailConfig, MailMessage } from "../email.js";
import { assertOkResponse } from "../http.js";

/**
 * Resend HTTP adapter (H52). Fully implemented against Resend's public API
 * (https://resend.com/docs/api-reference/emails/send-email); exercised in
 * tests via a stubbed `global.fetch`, never a live network call.
 */
export async function sendViaResend(mail: MailConfig, message: MailMessage): Promise<void> {
  if (!mail.resendApiKey) {
    throw new Error("Resend adapter: RESEND_API_KEY is not configured");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${mail.resendApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: `${mail.fromName} <${mail.fromAddress}>`,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
  });

  await assertOkResponse(res, "Resend");
}
