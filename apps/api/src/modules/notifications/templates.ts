import { LANGS, type Language } from "@hackos/shared/locale";
import { config } from "../../config.js";
import { emailTemplateExists, translateEmail } from "../../lib/i18n.js";

/**
 * Email template registry (H52). Every outbox row for channel=email carries
 * `payload = { template: string, vars?: Record<string, unknown>, subject?,
 * body? }`. Other modules enqueue by naming a template + vars; they never
 * build HTML themselves. Templates live as i18next resources in
 * packages/shared/locales/*\/email.json, keyed by name under `mail.`/
 * `push.`, each with subject/body (or title/body) per language (en | es |
 * gl — H7 i18n). `payload.vars.language` is NOT the source of truth: the
 * dispatcher always resolves language from `users.language`, falling back
 * to "en" (plan/07 §2 i18n).
 *
 * Unknown template names fall back to `generic`, which renders whatever the
 * caller put in payload.subject/payload.body (or a minimal default) so a
 * sibling module's typo never turns into a lost, unrenderable email.
 */

export type { Language };

export const SUPPORTED_LANGUAGES: Language[] = LANGS;

export function normalizeLanguage(lang: string | null | undefined): Language {
  return SUPPORTED_LANGUAGES.includes(lang as Language) ? (lang as Language) : "en";
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface RenderedPush {
  title: string;
  body: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function footerTextToHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\n/g, "<br/>")
    .replace(
      "hackudc@gpul.org",
      `<a href="mailto:hackudc@gpul.org" style="color:inherit;text-decoration:underline;">hackudc@gpul.org</a>`,
    );
}

// H52: email-safe values follow the brand rulebook (hackudc.com/en/brand):
// cream is the default surface and ink the default text; ink is also the
// primary action; red stays an accent. One flat surface per scheme, no cards,
// bands or gradients. Inline hex values work without CSS variables.
const EMAIL_BRAND_NAME = "hackOS";
const EMAIL_INK = "#030846";
const EMAIL_CREAM = "#FAFAFA";
const EMAIL_MUTED_TEXT = "#484C78"; // ink 72% on cream: secondary text
const EMAIL_HAIRLINE = "#DCDDE4"; // ink 12% on cream: dividers and frames
const EMAIL_COLUMN_WIDTH = 520;
const EMAIL_BUTTON_RADIUS = 8;

// H52: reuse the edition's self-hosted display face where email clients allow
// webfonts. Body text uses Inter when available and email-safe sans fallbacks.
const EMAIL_FONT_FACES = `
      @font-face { font-family:'Rockwell'; font-style:normal; font-weight:400; font-display:swap; src:url(${escapeHtml(`${config.WEB_URL}/fonts/hackudc-2027/rockwell-regular.woff2`)}) format('woff2'); }`;
const EMAIL_FONT_STACK =
  "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const EMAIL_DISPLAY_FONT_STACK = "'Rockwell',Georgia,'Times New Roman',serif";
const EMAIL_MONO_FONT_STACK =
  "ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace";

// Dark mode is a neutral near-black, not navy: cream logo and cream text on
// black is a sanctioned pairing, and the action inverts to a cream button.
const EMAIL_DARK_BG = "#0E0F11";
const EMAIL_DARK_TEXT = EMAIL_CREAM;
const EMAIL_DARK_MUTED = "#A7A9B3";
const EMAIL_DARK_HAIRLINE = "#2B2D33";

// H52: the navy logo is the default mark on cream; the cream one replaces it
// for dark mode. The swap uses prefers-color-scheme plus Outlook.com's
// dark-mode attributes; a client that darkens the page without telling the
// email keeps the navy mark, which the red one used to get wrong. PNG exports
// of the supplied SVGs keep it email-compatible.
function headerMarkup(): string {
  const imageStyle = "display:block;width:176px;max-width:100%;height:auto;border:0;outline:none;";
  return `<img class="email-logo-light" src="${escapeHtml(`${config.WEB_URL}/email/hackudc-2027-navy.png`)}" alt="HackUDC 2027" width="176" style="${imageStyle}" />
                <!--[if !mso]><!-->
                <div class="email-logo-dark" style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
                  <img src="${escapeHtml(`${config.WEB_URL}/email/hackudc-2027-dark.png`)}" alt="HackUDC 2027" width="176" style="${imageStyle}" />
                </div>
                <!--<![endif]-->`;
}

/** First ~140 chars of the plain-text body, shown by inbox clients next to the subject. */
function derivePreheader(plainText: string): string {
  const flat = plainText.replace(/\s+/g, " ").trim();
  return flat.length > 140 ? `${flat.slice(0, 139)}…` : flat;
}

function brandWrapHtml(
  subject: string,
  bodyHtml: string,
  preheader: string,
  language: Language,
  heading: string,
): string {
  return `<!doctype html>
<html lang="${language}">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(subject)}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no" />
    <style>
      :root { color-scheme: light dark; supported-color-schemes: light dark; }
      ${EMAIL_FONT_FACES}
      body { margin:0; padding:0; width:100% !important; }
      table { border-collapse:collapse; border-spacing:0; }
      a { color:${EMAIL_INK}; }
      .email-body a { word-break:break-word; }
      @media (prefers-color-scheme: dark) {
        body, .email-page { background:${EMAIL_DARK_BG} !important; }
        .email-logo-light { display:none !important; }
        .email-logo-dark { display:block !important; max-height:none !important; overflow:visible !important; }
        .email-text, .email-title, .email-body a { color:${EMAIL_DARK_TEXT} !important; }
        .email-muted, .email-muted a { color:${EMAIL_DARK_MUTED} !important; }
        .email-rule { border-color:${EMAIL_DARK_HAIRLINE} !important; }
        .email-btn td, .email-btn a { background:${EMAIL_CREAM} !important; color:${EMAIL_INK} !important; }
        .email-code { border-color:${EMAIL_DARK_HAIRLINE} !important; color:${EMAIL_DARK_TEXT} !important; }
      }
      [data-ogsc] .email-logo-light { display:none !important; }
      [data-ogsc] .email-logo-dark { display:block !important; max-height:none !important; overflow:visible !important; }
      @media only screen and (max-width:600px) {
        .email-pad { padding:32px 24px !important; }
        .email-title { font-size:25px !important; }
        .email-btn { width:100% !important; }
        .email-btn a { display:block !important; text-align:center !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:${EMAIL_CREAM};font-family:${EMAIL_FONT_STACK};-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}</div>
    <div style="display:none;max-height:0;overflow:hidden;">&#8199;&zwnj;&nbsp;&#8199;&zwnj;&nbsp;&#8199;&zwnj;&nbsp;&#8199;&zwnj;&nbsp;&#8199;&zwnj;&nbsp;</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-page" style="background:${EMAIL_CREAM};">
      <tr>
        <td align="center" class="email-pad" style="padding:48px 24px;">
          <table role="presentation" width="${EMAIL_COLUMN_WIDTH}" cellpadding="0" cellspacing="0" style="width:100%;max-width:${EMAIL_COLUMN_WIDTH}px;">
            <tr>
              <td align="left" style="padding:0 0 40px;">
                ${headerMarkup()}
              </td>
            </tr>
            <tr>
              <td class="email-body email-text" style="color:${EMAIL_INK};font-size:16px;line-height:1.65;word-break:break-word;text-align:left;">
                <h1 class="email-title" style="font-family:${EMAIL_DISPLAY_FONT_STACK};font-size:28px;line-height:1.2;font-weight:400;margin:0 0 24px;color:${EMAIL_INK};">${escapeHtml(heading)}</h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td class="email-rule email-muted" style="padding:24px 0 0;border-top:1px solid ${EMAIL_HAIRLINE};color:${EMAIL_MUTED_TEXT};font-size:13px;line-height:1.6;text-align:left;">
                <div style="font-weight:600;margin-bottom:4px;">${EMAIL_BRAND_NAME}</div>
                <div>${footerTextToHtml(translateEmail("mail.footer", language, {}))}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// A whole line that is exactly a bare URL, or a [Label](url) markdown link.
const BARE_URL_LINE = /^(https?:\/\/\S+)$/;
const LABELED_LINK_LINE = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/;

function ctaButton(url: string, label: string): string {
  // H15/H52: declining remains available without competing with confirmation.
  if (/^https?:\/\/[^/?#]+\/applications\/decline(?:[?#]|$)/.test(url)) {
    return `<p style="margin:0 0 24px;"><a class="email-muted" href="${escapeHtml(url)}" target="_blank" rel="noopener" style="color:${EMAIL_MUTED_TEXT};font-size:14px;text-decoration:underline;">${escapeHtml(label)}</a></p>`;
  }
  return `<table role="presentation" cellpadding="0" cellspacing="0" class="email-btn" style="margin:8px 0 28px;max-width:100%;">
  <tr><td bgcolor="${EMAIL_INK}" style="border-radius:${EMAIL_BUTTON_RADIUS}px;background:${EMAIL_INK};">
    <a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="display:inline-block;padding:13px 22px;line-height:1.4;color:${EMAIL_CREAM};font-size:15px;font-weight:600;text-decoration:none;border-radius:${EMAIL_BUTTON_RADIUS}px;">${escapeHtml(label)}</a>
  </td></tr>
</table>`;
}

// A line that is only a short numeric code (security PIN) reads as a code, not a sentence.
const CODE_LINE = /^\d{4,8}$/;

function codeBlock(code: string): string {
  return `<p style="margin:4px 0 24px;"><span class="email-code" style="display:inline-block;padding:14px 20px;border:1px solid ${EMAIL_HAIRLINE};border-radius:${EMAIL_BUTTON_RADIUS}px;font-family:${EMAIL_MONO_FONT_STACK};font-size:28px;line-height:1;font-weight:600;letter-spacing:0.28em;color:${EMAIL_INK};">${escapeHtml(code)}</span></p>`;
}

/**
 * Renders the plain-text body to email-safe HTML. Paragraphs are split on blank
 * lines. A line that is a bare URL or a `[Label](url)` markdown link becomes a
 * tappable CTA button (raw wrapping URLs looked terrible on phones); everything
 * else is escaped text with `<br/>` for soft line breaks.
 */
function renderBodyHtml(
  text: string,
  wallet?: { appleUrl: unknown; googleUrl: unknown; language: Language; ticketQr: boolean },
): string {
  let ticketRendered = false;
  return text
    .split(/\n\n+/)
    .map((para) => {
      let out = "";
      let buffer: string[] = [];
      const flush = () => {
        if (buffer.length > 0) {
          out += `<p style="margin:0 0 18px;">${buffer.join("<br/>")}</p>`;
          buffer = [];
        }
      };
      for (const rawLine of para.split("\n")) {
        const line = rawLine.trim();
        const labeled = line.match(LABELED_LINK_LINE);
        const bare = line.match(BARE_URL_LINE);
        if (CODE_LINE.test(line)) {
          flush();
          out += codeBlock(line);
        } else if (labeled) {
          flush();
          const walletBrand =
            wallet && labeled[2] === wallet.appleUrl
              ? "apple"
              : wallet && labeled[2] === wallet.googleUrl
                ? "google"
                : null;
          if (walletBrand && wallet) {
            if (wallet.ticketQr && !ticketRendered) {
              out += `<div style="margin:24px 0;text-align:center;"><img src="cid:event-ticket@hackos" alt="${escapeHtml(translateEmail("mail.event.reminder.ticketAlt", wallet.language, {}))}" width="240" height="240" style="display:block;margin:0 auto;width:240px;max-width:100%;height:auto;border:0;background:#ffffff;" /></div>`;
              ticketRendered = true;
            }
            const locale = wallet.language === "en" ? "en" : "es";
            const asset = walletBrand === "apple" ? "apple-wallet-badge" : "google-wallet-button";
            // H28/H52: preserve the official Wallet artwork used by /wallet.
            // PNG exports of those SVGs work in email clients without SVG support.
            const width = walletBrand === "google" ? 227 : locale === "en" ? 127 : 151;
            out += `<p style="margin:16px 0;"><a href="${escapeHtml(labeled[2] as string)}" target="_blank" rel="noopener" style="display:inline-block;"><img src="${escapeHtml(`${config.WEB_URL}/wallet-badges/${asset}-${locale}.png`)}" alt="${escapeHtml(labeled[1] as string)}" width="${width}" height="40" style="display:block;width:${width}px;max-width:100%;height:auto;border:0;" /></a></p>`;
          } else {
            out += ctaButton(labeled[2] as string, labeled[1] as string);
          }
        } else if (bare) {
          flush();
          out += ctaButton(bare[1] as string, bare[1] as string);
        } else {
          buffer.push(escapeHtml(rawLine));
        }
      }
      flush();
      return out;
    })
    .join("\n");
}

/** Strips `[Label](url)` markdown links to `Label: url` for the plain-text part. */
function bodyToPlainText(text: string): string {
  return text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1: $2");
}

export interface EmailPayload {
  template?: string;
  vars?: Record<string, unknown>;
  /** Only consulted by the `generic` fallback when no registered template matches. */
  subject?: string;
  body?: string;
  /**
   * Destination override (H1/H10 flows). When set, email is delivered here
   * instead of users.email, such as an invite to an address not yet linked to
   * the user row. Ignored by non-email channels.
   */
  recipient?: string;
  /**
   * Language override. When set, wins over users.language for THIS message —
   * useful when the user row's language isn't the right one for the flow
   * (e.g. an invite before the recipient has chosen a language). Unsupported
   * values fall back to en, same as users.language.
   */
  language?: string;
}

/** Renders subject/html/text for a template + language. Never throws — unknown template = generic. */
export function renderEmailTemplate(payload: EmailPayload, language: Language): RenderedEmail {
  let templateName =
    payload.template && emailTemplateExists(`mail.${payload.template}.subject`, language)
      ? payload.template
      : "generic";
  // H14/H52: complete localized sentences keep internal decision keys out of copy,
  // including decisions already queued with the original template name.
  if (
    templateName === "application.decision" &&
    (payload.vars?.decision === "accepted" || payload.vars?.decision === "rejected")
  ) {
    templateName = `${templateName}.${payload.vars.decision}`;
  }
  const vars: Record<string, unknown> = {
    subject: payload.subject ?? "hackOS notification",
    body: payload.body ?? "",
    fromAddress: config.MAIL_FROM_ADDRESS,
    eventName: config.APPLE_PASS_ORGANIZATION,
    ...payload.vars,
  };
  if (templateName === "auth.invite") {
    const roleNames = Array.isArray(vars.roleNames)
      ? vars.roleNames.filter((name) => typeof name === "string")
      : [];
    Object.assign(vars, {
      inviterName: vars.inviterName || translateEmail("mail.auth.invite.organizers", language, {}),
      accountAccess: [
        roleNames.length > 0
          ? translateEmail(
              `mail.auth.invite.${roleNames.length === 1 ? "role" : "roles"}`,
              language,
              { roleNames: roleNames.join(", ") },
            )
          : "",
        vars.enterpriseName
          ? translateEmail("mail.auth.invite.enterprise", language, {
              enterpriseName: vars.enterpriseName,
            })
          : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
  }
  const subject = translateEmail(`mail.${templateName}.subject`, language, vars);
  const heading = emailTemplateExists(`mail.${templateName}.heading`, language)
    ? translateEmail(`mail.${templateName}.heading`, language, vars)
    : subject;
  const rendered = translateEmail(`mail.${templateName}.body`, language, vars);
  const text = bodyToPlainText(rendered);
  const html = brandWrapHtml(
    subject,
    renderBodyHtml(
      rendered,
      templateName === "event.reminder"
        ? {
            appleUrl: payload.vars?.appleUrl,
            googleUrl: payload.vars?.googleUrl,
            language,
            ticketQr: payload.vars?.ticketQr === true,
          }
        : undefined,
    ),
    derivePreheader(text),
    language,
    heading,
  );
  return { subject, html, text };
}

/** Uses action-first push copy when defined, otherwise preserves the email rendering. */
export function renderPushTemplate(payload: EmailPayload, language: Language): RenderedPush {
  const exists =
    payload.template && emailTemplateExists(`push.${payload.template}.title`, language);
  if (!exists) {
    const rendered = renderEmailTemplate(payload, language);
    return { title: rendered.subject, body: rendered.text };
  }

  const templateName = payload.template as string;
  const vars = payload.vars ?? {};
  return {
    title: translateEmail(`push.${templateName}.title`, language, vars),
    body: translateEmail(`push.${templateName}.body`, language, vars),
  };
}
