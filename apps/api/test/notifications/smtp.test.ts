import { describe, expect, it } from "vitest";
import type { MailConfig } from "../../src/modules/notifications/channels/email.js";
import { smtpTransportOptions } from "../../src/modules/notifications/channels/email-adapters/smtp.js";

const baseMail: MailConfig = {
  provider: "smtp",
  fromAddress: "noreply@example.test",
  fromName: "hackOS",
  smtpHost: "smtp.example.test",
  smtpPort: 587,
  smtpSecure: false,
  smtpRequireTls: true,
};

describe("SMTP transport security", () => {
  it("requires STARTTLS for a submission relay", () => {
    expect(smtpTransportOptions(baseMail)).toMatchObject({
      host: "smtp.example.test",
      port: 587,
      secure: false,
      requireTLS: true,
    });
  });

  it("uses implicit TLS for SMTPS without attempting STARTTLS", () => {
    expect(smtpTransportOptions({ ...baseMail, smtpPort: 465, smtpSecure: true })).toEqual({
      host: "smtp.example.test",
      port: 465,
      secure: true,
      auth: undefined,
    });
  });

  it("uses an explicit TLS server name for a private relay address", () => {
    expect(
      smtpTransportOptions({
        ...baseMail,
        smtpHost: "10.33.66.156",
        smtpTlsServername: "mail.gpul.org",
      }),
    ).toMatchObject({
      host: "10.33.66.156",
      tls: { servername: "mail.gpul.org" },
    });
  });
});
