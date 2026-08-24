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

export interface EmailLayoutSettings {
  brandName: string;
  headerText: string;
  headerSubtext: string;
  logoUrl: string | undefined;
  accentColor: string;
  backgroundColor: string;
  cardColor: string;
  cardBorderColor: string;
  textColor: string;
  mutedTextColor: string;
  footerBackgroundColor: string;
  cardRadius: number;
  maxWidth: number;
  footerText: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function footerTextToHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, "<br/>");
}

export function emailLayoutSettingsFromConfig(): EmailLayoutSettings {
  return {
    brandName: config.MAIL_LAYOUT_BRAND_NAME,
    headerText: config.MAIL_LAYOUT_HEADER_TEXT,
    headerSubtext: config.MAIL_LAYOUT_HEADER_SUBTEXT,
    // apps/web serves this brand mark as a static public asset; overridable (or "" to
    // disable and fall back to the text header) for white-labeling.
    logoUrl:
      config.MAIL_LAYOUT_LOGO_URL === ""
        ? undefined
        : (config.MAIL_LAYOUT_LOGO_URL ?? `${config.WEB_URL}/email/brand-mark.png`),
    accentColor: config.MAIL_LAYOUT_ACCENT_COLOR,
    backgroundColor: config.MAIL_LAYOUT_BG_COLOR,
    cardColor: config.MAIL_LAYOUT_CARD_COLOR,
    cardBorderColor: config.MAIL_LAYOUT_CARD_BORDER_COLOR,
    textColor: config.MAIL_LAYOUT_TEXT_COLOR,
    mutedTextColor: config.MAIL_LAYOUT_MUTED_TEXT_COLOR,
    footerBackgroundColor: config.MAIL_LAYOUT_FOOTER_BG_COLOR,
    cardRadius: config.MAIL_LAYOUT_CARD_RADIUS,
    maxWidth: config.MAIL_LAYOUT_MAX_WIDTH,
    footerText: config.MAIL_FOOTER_TEXT,
  };
}

// Geist is apps/web's body face (next/font/google, apps/web/src/app/layout.tsx). Clients that
// support @font-face (Apple/iOS Mail, Outlook for Mac, most webmail) render it from Google's
// CDN; everything else falls back to the system stack, which Geist itself was designed to sit
// close to, so the fallback doesn't look like a different product.
const EMAIL_FONT_FACES = `
      @font-face { font-family:'Geist'; font-style:normal; font-weight:400; font-display:swap; src:url(https://fonts.gstatic.com/s/geist/v5/gyBhhwUxId8gMGYQMKR3pzfaWI_RnOM4nQ.ttf) format('truetype'); }
      @font-face { font-family:'Geist'; font-style:normal; font-weight:600; font-display:swap; src:url(https://fonts.gstatic.com/s/geist/v5/gyBhhwUxId8gMGYQMKR3pzfaWI_RQuQ4nQ.ttf) format('truetype'); }
      @font-face { font-family:'Geist'; font-style:normal; font-weight:700; font-display:swap; src:url(https://fonts.gstatic.com/s/geist/v5/gyBhhwUxId8gMGYQMKR3pzfaWI_Re-Q4nQ.ttf) format('truetype'); }`;
const EMAIL_FONT_STACK =
  "'Geist',-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif";

// Dark-mode message palette — the exact zinc tokens apps/web itself flips to in dark mode
// (apps/web/src/app/globals.css `.dark`), not a MAIL_LAYOUT_* setting: the message adapts to
// the client's theme the same way the app adapts to the user's, while the header stays pinned
// to the brand color always. Background and card share one value on purpose — in dark mode the
// card is delimited by its hairline border only, not a separate fill.
const EMAIL_DARK_BG = "#09090b";
const EMAIL_DARK_BORDER = "rgba(255,255,255,0.08)";
const EMAIL_DARK_TEXT = "#fafafa";
const EMAIL_DARK_MUTED = "#9f9fa9";
const EMAIL_DARK_BUTTON_BG = "#fafafa";
const EMAIL_DARK_BUTTON_TEXT = "#18181b";

// Mirrors the web wordmark's own ratio (BrandMark size-[1.3em], gap-[0.2em], text-2xl — see
// apps/web/src/components/common/brand.tsx): icon = 1.3x the text size, gap = 0.2x.
const EMAIL_HEADER_TEXT_PX = 24;
const EMAIL_HEADER_LOGO_PX = Math.round(EMAIL_HEADER_TEXT_PX * 1.3);
const EMAIL_HEADER_GAP_PX = Math.round(EMAIL_HEADER_TEXT_PX * 0.2);

function headerMarkup(layout: EmailLayoutSettings): string {
  if (layout.logoUrl) {
    return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>
                  <td valign="middle" style="padding-right:${EMAIL_HEADER_GAP_PX}px;">
                    <img src="${escapeHtml(layout.logoUrl)}" alt="${escapeHtml(layout.brandName)}" height="${EMAIL_HEADER_LOGO_PX}" style="display:block;height:${EMAIL_HEADER_LOGO_PX}px;width:auto;border:0;outline:none;" />
                  </td>
                  <td valign="middle" class="email-head-title" style="font-size:${EMAIL_HEADER_TEXT_PX}px;">${escapeHtml(layout.headerText)}</td>
                </tr></table>
                ${layout.headerSubtext ? `<div class="email-head-subtext" style="margin-top:8px;">${escapeHtml(layout.headerSubtext)}</div>` : ""}`;
  }
  return `<div class="email-head-title" style="font-size:${EMAIL_HEADER_TEXT_PX}px;">${escapeHtml(layout.headerText)}</div>
                ${layout.headerSubtext ? `<div class="email-head-subtext" style="margin-top:4px;">${escapeHtml(layout.headerSubtext)}</div>` : ""}`;
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
  layout: EmailLayoutSettings = emailLayoutSettingsFromConfig(),
): string {
  const width = Math.max(360, Math.min(layout.maxWidth, 720));
  const radius = Math.max(0, Math.min(layout.cardRadius, 32));
  // The header is a fixed brand element pinned with !important under prefers-color-scheme so
  // a client's own dark-mode remapping (Gmail, Outlook.com) can't invert it — it stays a dark
  // bar with a white logo/wordmark in both light- and dark-mode clients. The rest of the
  // message instead adapts to the client's theme (see EMAIL_DARK_* above).
  return `<!doctype html>
<html lang="en">
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
      a { color:${layout.accentColor}; }
      .email-body a { word-break:break-word; }
      .email-page, .email-card, .email-body, .email-foot { background:${layout.backgroundColor}; }
      .email-card { background:${layout.cardColor}; }
      .email-foot { background:${layout.footerBackgroundColor}; }
      .email-body, .email-title { color:${layout.textColor}; }
      .email-foot-brand, .email-foot-text { color:${layout.mutedTextColor}; }
      .email-btn a { background:${layout.accentColor}; color:#ffffff; }
      /* The header is a fixed brand element, not part of the adapting message — pin it under
         prefers-color-scheme so a client's own dark-mode remapping (Gmail, Outlook.com) can't
         invert it. */
      .email-head { background:${layout.accentColor}; }
      .email-head-title { color:#ffffff; font-weight:700; line-height:1.2; }
      .email-head-subtext { color:rgba(255,255,255,0.85); }
      @media (prefers-color-scheme: dark) {
        .email-head { background:${layout.accentColor} !important; }
        .email-head-title { color:#ffffff !important; }
        .email-head-subtext { color:rgba(255,255,255,0.85) !important; }
        /* Everything else adapts to the same zinc dark tokens apps/web itself uses — the card
           is delimited by its border only, no separate fill from the page background. */
        body, .email-page, .email-card, .email-body, .email-foot { background:${EMAIL_DARK_BG} !important; }
        .email-card { border-color:${EMAIL_DARK_BORDER} !important; }
        .email-foot { border-top-color:${EMAIL_DARK_BORDER} !important; }
        .email-body, .email-title { color:${EMAIL_DARK_TEXT} !important; }
        .email-foot-brand, .email-foot-text { color:${EMAIL_DARK_MUTED} !important; }
        .email-body a { color:${EMAIL_DARK_TEXT} !important; text-decoration:underline; }
        .email-btn a { background:${EMAIL_DARK_BUTTON_BG} !important; color:${EMAIL_DARK_BUTTON_TEXT} !important; }
      }
      @media only screen and (max-width:600px) {
        .email-pad { padding:24px 20px !important; }
        .email-head { padding:20px 20px !important; }
        .email-foot { padding:16px 20px !important; }
        .email-title { font-size:20px !important; }
        .email-btn a { display:block !important; text-align:center !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:${layout.backgroundColor};font-family:${EMAIL_FONT_STACK};-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}</div>
    <div style="display:none;max-height:0;overflow:hidden;">&#8199;&zwnj;&nbsp;&#8199;&zwnj;&nbsp;&#8199;&zwnj;&nbsp;&#8199;&zwnj;&nbsp;&#8199;&zwnj;&nbsp;</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="email-page" style="background:${layout.backgroundColor};padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="${width}" cellpadding="0" cellspacing="0" class="email-card" style="width:100%;max-width:${width}px;background:${layout.cardColor};border-radius:${radius}px;overflow:hidden;border:1px solid ${layout.cardBorderColor};">
            <tr>
              <td class="email-head" bgcolor="${layout.accentColor}" style="background:${layout.accentColor};padding:22px 24px;">
                ${headerMarkup(layout)}
              </td>
            </tr>
            <tr>
              <td class="email-body email-pad" style="padding:28px 24px;color:${layout.textColor};font-size:15px;line-height:1.6;word-break:break-word;">
                <h1 class="email-title" style="font-size:22px;line-height:1.3;font-weight:700;margin:0 0 18px;color:${layout.textColor};">${escapeHtml(subject)}</h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td class="email-foot" style="padding:16px 24px;color:${layout.mutedTextColor};font-size:12px;line-height:1.5;background:${layout.footerBackgroundColor};border-top:1px solid ${layout.cardBorderColor};">
                <div class="email-foot-brand" style="font-weight:600;margin-bottom:4px;">${escapeHtml(layout.brandName)}</div>
                <div class="email-foot-text">${footerTextToHtml(layout.footerText)}</div>
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

function ctaButton(url: string, label: string, layout: EmailLayoutSettings): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" class="email-btn" style="margin:4px 0 20px;">
  <tr><td class="email-btn" bgcolor="${layout.accentColor}" style="border-radius:8px;background:${layout.accentColor};">
    <a href="${escapeHtml(url)}" target="_blank" rel="noopener" style="display:inline-block;padding:13px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;border-radius:8px;">${escapeHtml(label)}</a>
  </td></tr>
</table>`;
}

/**
 * Renders the plain-text body to email-safe HTML. Paragraphs are split on blank
 * lines. A line that is a bare URL or a `[Label](url)` markdown link becomes a
 * tappable CTA button (raw wrapping URLs looked terrible on phones); everything
 * else is escaped text with `<br/>` for soft line breaks.
 */
function renderBodyHtml(text: string, layout: EmailLayoutSettings): string {
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
          out += ctaButton(labeled[2] as string, labeled[1] as string, layout);
        } else if (bare) {
          flush();
          out += ctaButton(bare[1] as string, bare[1] as string, layout);
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
export function renderEmailTemplate(
  payload: EmailPayload,
  language: Language,
  layout: EmailLayoutSettings = emailLayoutSettingsFromConfig(),
): RenderedEmail {
  const templateName =
    payload.template && emailTemplateExists(`mail.${payload.template}.subject`, language)
      ? payload.template
      : "generic";
  const vars = {
    subject: payload.subject ?? "hackOS notification",
    body: payload.body ?? "",
    fromAddress: config.MAIL_FROM_ADDRESS,
    ...payload.vars,
  };
  const subject = translateEmail(`mail.${templateName}.subject`, language, vars);
  const rendered = translateEmail(`mail.${templateName}.body`, language, vars);
  const text = bodyToPlainText(rendered);
  const html = brandWrapHtml(
    subject,
    renderBodyHtml(rendered, layout),
    derivePreheader(text),
    layout,
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
