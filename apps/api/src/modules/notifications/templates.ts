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

function brandWrapHtml(
  subject: string,
  bodyHtml: string,
  layout: EmailLayoutSettings = emailLayoutSettingsFromConfig(),
): string {
  const width = Math.max(360, Math.min(layout.maxWidth, 720));
  const radius = Math.max(0, Math.min(layout.cardRadius, 32));
  // Force light rendering: the layout palette is light-themed, so we opt out of
  // client auto-inversion (Apple Mail on iOS especially) which washes the card
  // to an unreadable grey. `color-scheme: light` + a solid background keep the
  // design consistent across light/dark devices.
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <style>
      :root { color-scheme: light; supported-color-schemes: light; }
      body { margin:0; padding:0; width:100% !important; }
      a { color:${layout.accentColor}; }
      .email-body a { word-break:break-word; }
      @media only screen and (max-width:600px) {
        .email-pad { padding:24px 20px !important; }
        .email-head { padding:20px 20px !important; }
        .email-foot { padding:16px 20px !important; }
        .email-title { font-size:20px !important; }
        .email-btn a { display:block !important; text-align:center !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:${layout.backgroundColor};font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:100%;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${layout.backgroundColor};padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="${width}" cellpadding="0" cellspacing="0" style="width:100%;max-width:${width}px;background:${layout.cardColor};border-radius:${radius}px;overflow:hidden;border:1px solid ${layout.cardBorderColor};">
            <tr>
              <td class="email-head" style="background:${layout.accentColor};padding:22px 24px;">
                <div style="color:#ffffff;font-size:20px;font-weight:700;line-height:1.2;">${escapeHtml(layout.headerText)}</div>
                <div style="color:rgba(255,255,255,0.9);font-size:13px;margin-top:4px;line-height:1.4;">${escapeHtml(layout.headerSubtext)}</div>
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
                <div style="font-weight:600;margin-bottom:4px;">${escapeHtml(layout.brandName)}</div>
                <div>${footerTextToHtml(layout.footerText)}</div>
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
  <tr><td style="border-radius:8px;background:${layout.accentColor};">
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
  const html = brandWrapHtml(subject, renderBodyHtml(rendered, layout), layout);
  const text = bodyToPlainText(rendered);
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
