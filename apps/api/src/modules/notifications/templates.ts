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

// H52: email-safe values mirror docs/DESIGN.md §2 and the active edition in
// apps/web/src/styles/theme.css. Inline hex fallbacks work without CSS variables.
const EMAIL_BRAND_NAME = "hackOS";
const EMAIL_ACCENT_COLOR = "#bf2100";
const EMAIL_BACKGROUND_COLOR = "#e6f0fb"; // --hackos-shell: blue 12% + cream
const EMAIL_CARD_COLOR = "#fafafa";
const EMAIL_CARD_BORDER_COLOR = "#c9cad6"; // --border: ink 20% + cream
const EMAIL_TEXT_COLOR = "#030846";
const EMAIL_MUTED_TEXT_COLOR = "#484c78"; // --muted-foreground: ink 72% + cream
const EMAIL_FOOTER_BACKGROUND_COLOR = "#edf4fb"; // --muted: blue 15% + cream
const EMAIL_CARD_RADIUS = 8;
const EMAIL_BUTTON_RADIUS = 999;
const EMAIL_MAX_WIDTH = 560;

// H52: reuse the edition's self-hosted display face where email clients allow
// webfonts. Body text uses Inter when available and email-safe sans fallbacks.
const EMAIL_FONT_FACES = `
      @font-face { font-family:'Rockwell'; font-style:normal; font-weight:400; font-display:swap; src:url(${escapeHtml(`${config.WEB_URL}/fonts/hackudc-2027/rockwell-regular.woff2`)}) format('woff2'); }`;
const EMAIL_FONT_STACK =
  "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const EMAIL_DISPLAY_FONT_STACK = "'Rockwell',Georgia,'Times New Roman',serif";

const EMAIL_DARK_BG = "#0b0d14";
const EMAIL_DARK_CARD = "#171a23";
const EMAIL_DARK_FOOTER = "#242833";
const EMAIL_DARK_BORDER = "#292d37";
const EMAIL_DARK_TEXT = "#fafafa";
const EMAIL_DARK_MUTED = "#a3aab8";
const EMAIL_DARK_BUTTON_BG = EMAIL_ACCENT_COLOR;
const EMAIL_DARK_BUTTON_TEXT = "#fafafa";

// H52: PNG exports of the supplied edition SVGs keep logos email-compatible.
function headerMarkup(): string {
  const imageStyle =
    "display:block;width:360px;max-width:100%;height:auto;margin:0 auto;border:0;outline:none;";
  return `<img class="email-logo-light" src="${escapeHtml(`${config.WEB_URL}/email/hackudc-2027.png`)}" alt="HackUDC 2027" width="360" style="${imageStyle}" />
                <!--[if !mso]><!-->
                <div class="email-logo-dark" style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
                  <img src="${escapeHtml(`${config.WEB_URL}/email/hackudc-2027-dark.png`)}" alt="HackUDC 2027" width="360" style="${imageStyle}" />
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
  // H52: the header shares the message surface in both themes. Edition red
  // identifies correspondence and actions, rather than an admission status.
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
      a { color:${EMAIL_ACCENT_COLOR}; }
      .email-body a { word-break:break-word; }
      .email-page, .email-card, .email-body, .email-foot { background:${EMAIL_CARD_COLOR}; }
      .email-page { background:${EMAIL_BACKGROUND_COLOR}; }
      .email-card { background:${EMAIL_CARD_COLOR}; border-collapse:separate; }
      .email-foot { background:${EMAIL_FOOTER_BACKGROUND_COLOR}; }
      .email-body, .email-title { color:${EMAIL_TEXT_COLOR}; }
      .email-foot-brand, .email-foot-text { color:${EMAIL_MUTED_TEXT_COLOR}; }
      .email-btn td, .email-btn a { background:${EMAIL_ACCENT_COLOR}; color:${EMAIL_CARD_COLOR}; }
      .email-head { background:${EMAIL_CARD_COLOR}; }
      @media (prefers-color-scheme: dark) {
        .email-logo-light { display:none !important; }
        .email-logo-dark { display:block !important; max-height:none !important; overflow:visible !important; }
        .email-head { background:${EMAIL_DARK_CARD} !important; }
        body, .email-page { background:${EMAIL_DARK_BG} !important; }
        .email-card, .email-body { background:${EMAIL_DARK_CARD} !important; }
        .email-foot { background:${EMAIL_DARK_FOOTER} !important; }
        .email-card { border-color:${EMAIL_DARK_BORDER} !important; }
        .email-foot { border-top-color:${EMAIL_DARK_BORDER} !important; }
        .email-body, .email-title { color:${EMAIL_DARK_TEXT} !important; }
        .email-foot-brand, .email-foot-text { color:${EMAIL_DARK_MUTED} !important; }
        .email-body a { color:${EMAIL_DARK_TEXT} !important; text-decoration:underline; }
        .email-btn td, .email-btn a { background:${EMAIL_DARK_BUTTON_BG} !important; color:${EMAIL_DARK_BUTTON_TEXT} !important; }
      }
      @media only screen and (max-width:600px) {
        .email-pad { padding:24px !important; }
        .email-head { padding:24px 24px 0 !important; }
        .email-foot { padding:16px 24px !important; }
        .email-title { font-size:24px !important; }
        .email-btn { width:100% !important; }
        .email-btn a { display:block !important; text-align:center !important; }
      }
    </style>
  </head>
    <body style="margin:0;padding:0;background:${EMAIL_BACKGROUND_COLOR};font-family:${EMAIL_FONT_STACK};-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}</div>
    <div style="display:none;max-height:0;overflow:hidden;">&#8199;&zwnj;&nbsp;&#8199;&zwnj;&nbsp;&#8199;&zwnj;&nbsp;&#8199;&zwnj;&nbsp;&#8199;&zwnj;&nbsp;</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-page" style="background:${EMAIL_BACKGROUND_COLOR};">
      <tr>
        <td align="center" style="padding:32px 12px;">
          <table role="presentation" width="${EMAIL_MAX_WIDTH}" cellpadding="0" cellspacing="0" class="email-card" style="width:100%;max-width:${EMAIL_MAX_WIDTH}px;background:${EMAIL_CARD_COLOR};border-radius:${EMAIL_CARD_RADIUS}px;overflow:hidden;border:1px solid ${EMAIL_CARD_BORDER_COLOR};">
            <tr>
              <td class="email-head" align="center" bgcolor="${EMAIL_CARD_COLOR}" style="background:${EMAIL_CARD_COLOR};padding:24px 32px 0;">
                ${headerMarkup()}
              </td>
            </tr>
            <tr>
              <td class="email-body email-pad" style="padding:32px;color:${EMAIL_TEXT_COLOR};font-size:15px;line-height:1.6;word-break:break-word;">
                <h1 class="email-title" style="font-family:${EMAIL_DISPLAY_FONT_STACK};font-size:24px;line-height:1.333;font-weight:400;margin:0 0 24px;color:${EMAIL_TEXT_COLOR};">${escapeHtml(heading)}</h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td class="email-foot" style="padding:24px 32px;color:${EMAIL_MUTED_TEXT_COLOR};font-size:12px;line-height:1.5;background:${EMAIL_FOOTER_BACKGROUND_COLOR};border-top:1px solid ${EMAIL_CARD_BORDER_COLOR};">
                <div class="email-foot-brand" style="font-weight:600;margin-bottom:4px;">${EMAIL_BRAND_NAME}</div>
                <div class="email-foot-text">${footerTextToHtml(translateEmail("mail.footer", language, {}))}</div>
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
    return `<p style="margin:0 0 24px;"><a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="color:${EMAIL_TEXT_COLOR};font-size:14px;text-decoration:underline;">${escapeHtml(label)}</a></p>`;
  }
  return `<table role="presentation" cellpadding="0" cellspacing="0" class="email-btn" style="margin:8px 0 24px;max-width:100%;">
  <tr><td bgcolor="${EMAIL_ACCENT_COLOR}" style="border-radius:${EMAIL_BUTTON_RADIUS}px;background:${EMAIL_ACCENT_COLOR};">
    <a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 24px;line-height:1.5;color:${EMAIL_CARD_COLOR};font-size:15px;font-weight:600;text-decoration:none;border-radius:${EMAIL_BUTTON_RADIUS}px;">${escapeHtml(label)}</a>
  </td></tr>
</table>`;
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
          out += `<p style="margin:0 0 16px;">${buffer.join("<br/>")}</p>`;
          buffer = [];
        }
      };
      for (const rawLine of para.split("\n")) {
        const line = rawLine.trim();
        const labeled = line.match(LABELED_LINK_LINE);
        const bare = line.match(BARE_URL_LINE);
        if (labeled) {
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
   * Destination override (H1/H6/H10 flows). When set, email is delivered here
   * instead of users.email — e.g. a secondary-email verification (H6) or an
   * invite to an address not yet linked to the user row. Ignored by non-email
   * channels.
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
