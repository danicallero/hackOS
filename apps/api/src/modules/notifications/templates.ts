import { config } from "../../config.js";

/**
 * Email template registry (H52). Every outbox row for channel=email carries
 * `payload = { template: string, vars?: Record<string, unknown>, subject?,
 * body? }`. Other modules enqueue by naming a template + vars; they never
 * build HTML themselves. Templates are keyed by name, each with subject/body
 * per language (en | es | gl — H7 i18n). `payload.vars.language` is NOT the
 * source of truth: the dispatcher always resolves language from
 * `users.language`, falling back to "en" (plan/07 §2 i18n).
 *
 * Unknown template names fall back to `generic`, which renders whatever the
 * caller put in payload.subject/payload.body (or a minimal default) so a
 * sibling module's typo never turns into a lost, unrenderable email.
 */

export type Language = "en" | "es" | "gl";

export const SUPPORTED_LANGUAGES: Language[] = ["en", "es", "gl"];

export function normalizeLanguage(lang: string | null | undefined): Language {
  return SUPPORTED_LANGUAGES.includes(lang as Language) ? (lang as Language) : "en";
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
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

interface TemplateVariant {
  subject: string;
  /** Plain-text body; `\n\n` separates paragraphs. May contain {{vars}}. */
  body: string;
}

type TemplateDefinition = Record<Language, TemplateVariant>;

/** {{name}} interpolation — deliberately dumb, no HTML escaping beyond entities. */
function interpolate(str: string, vars: Record<string, unknown>): string {
  return str.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = vars[key];
    return value === undefined || value === null ? "" : String(value);
  });
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

const TEMPLATES: Record<string, TemplateDefinition> = {
  generic: {
    en: { subject: "{{subject}}", body: "{{body}}" },
    es: { subject: "{{subject}}", body: "{{body}}" },
    gl: { subject: "{{subject}}", body: "{{body}}" },
  },
  "auth.verify": {
    en: {
      subject: "Verify your hackOS email",
      body: "Hi {{name}},\n\nConfirm your email address to unlock the rest of hackOS:\n{{verifyUrl}}\n\nIf you didn't request this, ignore this message.",
    },
    es: {
      subject: "Verifica tu correo de hackOS",
      body: "Hola {{name}},\n\nConfirma tu dirección de correo para desbloquear el resto de hackOS:\n{{verifyUrl}}\n\nSi no lo has pedido tú, ignora este mensaje.",
    },
    gl: {
      subject: "Verifica o teu correo de hackOS",
      body: "Ola {{name}},\n\nConfirma o teu enderezo de correo para desbloquear o resto de hackOS:\n{{verifyUrl}}\n\nSe non o pediches ti, ignora esta mensaxe.",
    },
  },
  "auth.reset": {
    en: {
      subject: "Reset your hackOS password",
      body: "Hi {{name}},\n\nUse this link to set a new password:\n{{resetUrl}}\n\nIf you didn't request this, you can safely ignore this email — your password hasn't changed.",
    },
    es: {
      subject: "Restablece tu contraseña de hackOS",
      body: "Hola {{name}},\n\nUsa este enlace para fijar una contraseña nueva:\n{{resetUrl}}\n\nSi no lo has pedido tú, puedes ignorar este correo — tu contraseña no ha cambiado.",
    },
    gl: {
      subject: "Restablece o teu contrasinal de hackOS",
      body: "Ola {{name}},\n\nUsa esta ligazón para fixar un contrasinal novo:\n{{resetUrl}}\n\nSe non o pediches ti, podes ignorar este correo — o teu contrasinal non cambiou.",
    },
  },
  "auth.invite": {
    en: {
      subject: "You're invited to hackOS",
      body: "Hi,\n\nCreate your account to continue:\n{{claimUrl}}\n\nSet your password, name and the rest of your details from there.",
    },
    es: {
      subject: "Te han invitado a hackOS",
      body: "Hola,\n\nCrea tu cuenta para continuar:\n{{claimUrl}}\n\nDesde ahí fijas tu contraseña, nombre y el resto de tus datos.",
    },
    gl: {
      subject: "Convidáronte a hackOS",
      body: "Ola,\n\nCrea a túa conta para continuar:\n{{claimUrl}}\n\nDende alí fixa o teu contrasinal, nome e o resto dos teus datos.",
    },
  },
  "queue.called": {
    en: {
      subject: "Your team was called",
      body: "Hi {{name}},\n\nYour team {{teamName}} was called for {{challengeName}}. Please head to room {{roomName}} and wait at the door until you are called in.",
    },
    es: {
      subject: "Han llamado a tu equipo",
      body: "Hola {{name}},\n\nHan llamado a tu equipo {{teamName}} para {{challengeName}}. Dirígete a la sala {{roomName}} y espera en la puerta hasta que te llamen.",
    },
    gl: {
      subject: "Chamaron ao teu equipo",
      body: "Ola {{name}},\n\nChamaron ao teu equipo {{teamName}} para {{challengeName}}. Diríxete á sala {{roomName}} e agarda na porta ata que te chamen.",
    },
  },
  "application.decision": {
    en: {
      subject: "A decision on your application",
      body: "Hi {{name}},\n\nYour application to {{applicationName}} has been {{decision}}.\n{{decisionDetails}}",
    },
    es: {
      subject: "Una decisión sobre tu solicitud",
      body: "Hola {{name}},\n\nTu solicitud a {{applicationName}} ha sido {{decision}}.\n{{decisionDetails}}",
    },
    gl: {
      subject: "Unha decisión sobre a túa solicitude",
      body: "Ola {{name}},\n\nA túa solicitude a {{applicationName}} foi {{decision}}.\n{{decisionDetails}}",
    },
  },
};

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
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:${layout.backgroundColor};font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${layout.backgroundColor};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="${width}" cellpadding="0" cellspacing="0" style="width:100%;max-width:${width}px;background:${layout.cardColor};border-radius:${radius}px;overflow:hidden;border:1px solid ${layout.cardBorderColor};">
            <tr>
              <td style="background:${layout.accentColor};padding:22px 24px;">
                <div style="color:#ffffff;font-size:20px;font-weight:700;line-height:1.2;">${escapeHtml(layout.headerText)}</div>
                <div style="color:rgba(255,255,255,0.9);font-size:13px;margin-top:4px;line-height:1.4;">${escapeHtml(layout.headerSubtext)}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 24px;color:${layout.textColor};font-size:15px;line-height:1.6;">
                <h1 style="font-size:22px;line-height:1.3;font-weight:700;margin:0 0 18px;color:${layout.textColor};">${escapeHtml(subject)}</h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;color:${layout.mutedTextColor};font-size:12px;line-height:1.5;background:${layout.footerBackgroundColor};border-top:1px solid ${layout.cardBorderColor};">
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

function textToHtmlParagraphs(text: string): string {
  return text
    .split(/\n\n+/)
    .map((para) => `<p style="margin:0 0 12px;">${escapeHtml(para).replace(/\n/g, "<br/>")}</p>`)
    .join("\n");
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
    payload.template && TEMPLATES[payload.template] ? payload.template : "generic";
  // TEMPLATES.generic always exists (defined above); noUncheckedIndexedAccess
  // can't see that through the Record<string, ...> index signature.
  const definition = TEMPLATES[templateName] ?? (TEMPLATES.generic as TemplateDefinition);
  const variant = definition[language] ?? definition.en;
  const vars = {
    subject: payload.subject ?? "hackOS notification",
    body: payload.body ?? "",
    ...payload.vars,
  };
  const subject = interpolate(variant.subject, vars);
  const text = interpolate(variant.body, vars);
  const html = brandWrapHtml(subject, textToHtmlParagraphs(text), layout);
  return { subject, html, text };
}

export const TEMPLATE_NAMES = Object.keys(TEMPLATES);
