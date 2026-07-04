import { config } from "../../../config.js";
import type { Queryable } from "../../../db/pool.js";
import type { EmailPayload } from "../templates.js";
import { normalizeLanguage, renderEmailTemplate } from "../templates.js";
import { sendViaPostal } from "./email-adapters/postal.js";
import { sendViaResend } from "./email-adapters/resend.js";
import { sendViaSmtp } from "./email-adapters/smtp.js";

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Resolved mail configuration handed to the provider adapters.
 *
 * DELTA(H52): the story says the provider is chosen "por base de datos"; per
 * explicit user decision it is instead fixed at deploy time via env vars
 * (config.MAIL_PROVIDER et al., see src/config.ts). Switching
 * Resend/SMTP/Postal is an ops change (env + restart), not a runtime toggle,
 * and there is no mail settings table or admin endpoint.
 */
export interface MailConfig {
  provider: "smtp" | "resend" | "postal";
  fromAddress: string;
  fromName: string;
  resendApiKey?: string;
  postalUrl?: string;
  postalApiKey?: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser?: string;
  smtpPass?: string;
}

export function mailConfigFromEnv(): MailConfig {
  return {
    provider: config.MAIL_PROVIDER,
    fromAddress: config.MAIL_FROM_ADDRESS,
    fromName: config.MAIL_FROM_NAME,
    resendApiKey: config.RESEND_API_KEY,
    postalUrl: config.POSTAL_URL,
    postalApiKey: config.POSTAL_API_KEY,
    smtpHost: config.SMTP_HOST,
    smtpPort: config.SMTP_PORT,
    smtpUser: config.SMTP_USER,
    smtpPass: config.SMTP_PASS,
  };
}

/**
 * Dispatches one email outbox row (H52). Resolves the recipient's language
 * from `users.language` (never trusts payload.vars for that), renders the
 * template, and hands off to whichever provider adapter MAIL_PROVIDER names.
 */
export async function sendEmail(
  db: Queryable,
  userId: number,
  payload: EmailPayload,
  mail: MailConfig = mailConfigFromEnv(),
): Promise<void> {
  const { rows } = await db.query(`SELECT email, language FROM users WHERE id = $1`, [userId]);
  const user = rows[0] as { email: string; language: string } | undefined;
  if (!user) throw new Error(`sendEmail: user ${userId} not found`);

  // payload.recipient / payload.language override the user row (H1/H6/H10
  // flows that mail an address or language not yet on the user record).
  const to = payload.recipient ?? user.email;
  const language = normalizeLanguage(payload.language ?? user.language);
  const rendered = renderEmailTemplate(payload, language);
  const message: MailMessage = {
    to,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  };

  switch (mail.provider) {
    case "resend":
      return sendViaResend(mail, message);
    case "postal":
      return sendViaPostal(mail, message);
    default:
      return sendViaSmtp(mail, message);
  }
}
