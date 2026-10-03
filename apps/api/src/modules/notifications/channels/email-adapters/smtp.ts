import nodemailer from "nodemailer";
import { PermanentDispatchError } from "../../errors.js";
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
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  };
}

let pooledTransport: ReturnType<typeof nodemailer.createTransport> | null = null;
let pooledTransportKey = "";

function transportFor(mail: MailConfig) {
  const key = JSON.stringify({
    provider: mail.provider,
    fromAddress: mail.fromAddress,
    fromName: mail.fromName,
    smtpHost: mail.smtpHost,
    smtpTlsServername: mail.smtpTlsServername,
    smtpPort: mail.smtpPort,
    smtpUser: mail.smtpUser,
    smtpSecure: mail.smtpSecure,
    smtpRequireTls: mail.smtpRequireTls,
  });
  if (!pooledTransport || pooledTransportKey !== key) {
    pooledTransport?.close();
    pooledTransport = nodemailer.createTransport(smtpTransportOptions(mail));
    pooledTransportKey = key;
  }
  return pooledTransport;
}

export async function sendViaSmtp(mail: MailConfig, message: MailMessage): Promise<void> {
  const info = await transportFor(mail).sendMail({
    from: `${mail.fromName} <${mail.fromAddress}>`,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    attachments: message.attachments,
  });
  if (info.accepted.length === 0 && info.rejected.length > 0) {
    throw new PermanentDispatchError("SMTP relay rejected the recipient");
  }
}
