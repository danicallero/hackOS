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
      body: "Hi {{name}},\n\nYour team {{teamName}} was called for {{challengeName}}. Please head to room {{roomName}} and wait there.",
    },
    es: {
      subject: "Han llamado a tu equipo",
      body: "Hola {{name}},\n\nHan llamado a tu equipo {{teamName}} para {{challengeName}}. Dirígete a la sala {{roomName}} y espera allí.",
    },
    gl: {
      subject: "Chamaron ao teu equipo",
      body: "Ola {{name}},\n\nChamaron ao teu equipo {{teamName}} para {{challengeName}}. Diríxete á sala {{roomName}} e agarda alí.",
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

function brandWrapHtml(subject: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0f1115;font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f1115;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="background:#4f46e5;padding:20px 24px;">
                <span style="color:#ffffff;font-size:20px;font-weight:700;">hackOS</span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;color:#1f2430;font-size:15px;line-height:1.5;">
                <h1 style="font-size:18px;margin:0 0 16px;">${escapeHtml(subject)}</h1>
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;color:#8a93a6;font-size:12px;background:#f4f5f8;">
                hackOS — this is an automated message.
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
export function renderEmailTemplate(payload: EmailPayload, language: Language): RenderedEmail {
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
  const html = brandWrapHtml(subject, textToHtmlParagraphs(text));
  return { subject, html, text };
}

export const TEMPLATE_NAMES = Object.keys(TEMPLATES);
