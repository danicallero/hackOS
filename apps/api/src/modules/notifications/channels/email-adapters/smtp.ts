import nodemailer from "nodemailer";
import type { MailConfig, MailMessage } from "../email.js";

/**
 * SMTP adapter (H52) — Nodemailer against SMTP_HOST/PORT (+ optional
 * SMTP_USER/PASS). Port 587 starts clear then requires a STARTTLS upgrade;
 * SMTP_SECURE=true selects implicit TLS for SMTPS/465. In dev/test Mailpit
 * runs on localhost:1025 without TLS.
 */
export function smtpTransportOptions(mail: MailConfig) {
  return {
    host: mail.smtpHost,
    port: mail.smtpPort,
    secure: mail.smtpSecure,
    // `requireTLS` only applies to STARTTLS. Supplying it for SMTPS is
    // harmless, but omitting it keeps the selected protocol unambiguous.
    ...(mail.smtpSecure ? {} : { requireTLS: mail.smtpRequireTls }),
    // Keep certificate validation tied to the public mail hostname when the
    // TCP connection must target a private relay address.
    ...(mail.smtpTlsServername ? { tls: { servername: mail.smtpTlsServername } } : {}),
    auth: mail.smtpUser ? { user: mail.smtpUser, pass: mail.smtpPass } : undefined,
  };
}

export async function sendViaSmtp(mail: MailConfig, message: MailMessage): Promise<void> {
  const transport = nodemailer.createTransport(smtpTransportOptions(mail));

  await transport.sendMail({
    from: `${mail.fromName} <${mail.fromAddress}>`,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
  });
}
