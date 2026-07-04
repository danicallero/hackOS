import nodemailer from "nodemailer";
import type { MailConfig, MailMessage } from "../email.js";

/**
 * SMTP adapter (H52) — nodemailer against config.SMTP_HOST/PORT (+ optional
 * SMTP_USER/PASS). In dev/test that's the Mailpit container (localhost:1025,
 * no auth); production points the env at a real relay.
 */
export async function sendViaSmtp(mail: MailConfig, message: MailMessage): Promise<void> {
  const transport = nodemailer.createTransport({
    host: mail.smtpHost,
    port: mail.smtpPort,
    secure: false,
    auth: mail.smtpUser ? { user: mail.smtpUser, pass: mail.smtpPass } : undefined,
  });

  await transport.sendMail({
    from: `${mail.fromName} <${mail.fromAddress}>`,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });
}
