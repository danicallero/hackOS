import type { MailConfig, MailMessage } from "../email.js";
import { assertOkResponse } from "../http.js";

/**
 * Postal HTTP adapter (H52) — self-hosted mail server, so `POSTAL_URL`
 * carries the server base URL alongside the per-server API key. Endpoint per
 * https://apiv1.postalserver.io/controllers/send/message.html. Fully
 * implemented; tests stub `global.fetch`, never hit a live network call.
 */
export async function sendViaPostal(mail: MailConfig, message: MailMessage): Promise<void> {
  if (!mail.postalApiKey || !mail.postalUrl) {
    throw new Error("Postal adapter: POSTAL_API_KEY / POSTAL_URL is not configured");
  }

  const res = await fetch(`${mail.postalUrl.replace(/\/$/, "")}/api/v1/send/message`, {
    method: "POST",
    headers: {
      "X-Server-API-Key": mail.postalApiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      to: [message.to],
      from: `${mail.fromName} <${mail.fromAddress}>`,
      subject: message.subject,
      html_body: message.html,
      plain_body: message.text,
    }),
  });

  await assertOkResponse(res, "Postal");

  const data = (await res.json().catch(() => null)) as { status?: string } | null;
  if (data?.status && data.status !== "success") {
    throw new Error(`Postal send failed: status=${data.status}`);
  }
}
