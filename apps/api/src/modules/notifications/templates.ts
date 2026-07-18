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

interface TemplateVariant {
  subject: string;
  /** Plain-text body; `\n\n` separates paragraphs. May contain {{vars}}. */
  body: string;
}

type TemplateDefinition = Record<Language, TemplateVariant>;

interface PushTemplateVariant {
  title: string;
  body: string;
}

type PushTemplateDefinition = Record<Language, PushTemplateVariant>;

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
      body: "Hi {{name}},\n\nConfirm your email address to unlock the rest of hackOS:\n\n[Verify email]({{verifyUrl}})\n\nDon't see this email? Check your spam or junk folder — mark it as not spam so future messages (including ones with links) reach your inbox.\n\nIf you didn't request this, ignore this message.",
    },
    es: {
      subject: "Verifica tu correo de hackOS",
      body: "Hola {{name}},\n\nConfirma tu dirección de correo para desbloquear el resto de hackOS:\n\n[Verificar correo]({{verifyUrl}})\n\n¿No ves este correo? Revisa la carpeta de spam o correo no deseado y márcalo como \"no es spam\" para que los próximos mensajes (incluidos los que llevan enlaces) te lleguen a la bandeja de entrada.\n\nSi no lo has pedido tú, ignora este mensaje.",
    },
    gl: {
      subject: "Verifica o teu correo de hackOS",
      body: "Ola {{name}},\n\nConfirma o teu enderezo de correo para desbloquear o resto de hackOS:\n\n[Verificar correo]({{verifyUrl}})\n\nNon ves este correo? Revisa o cartafol de spam ou correo non desexado e márcao como \"non é spam\" para que as próximas mensaxes (incluídas as que levan ligazóns) che cheguen á caixa de entrada.\n\nSe non o pediches ti, ignora esta mensaxe.",
    },
  },
  "auth.reset": {
    en: {
      subject: "Reset your hackOS password",
      body: "Hi {{name}},\n\nUse this button to set a new password:\n\n[Reset password]({{resetUrl}})\n\nIf you didn't request this, you can safely ignore this email — your password hasn't changed.",
    },
    es: {
      subject: "Restablece tu contraseña de hackOS",
      body: "Hola {{name}},\n\nUsa este botón para fijar una contraseña nueva:\n\n[Restablecer contraseña]({{resetUrl}})\n\nSi no lo has pedido tú, puedes ignorar este correo — tu contraseña no ha cambiado.",
    },
    gl: {
      subject: "Restablece o teu contrasinal de hackOS",
      body: "Ola {{name}},\n\nUsa este botón para fixar un contrasinal novo:\n\n[Restablecer contrasinal]({{resetUrl}})\n\nSe non o pediches ti, podes ignorar este correo — o teu contrasinal non cambiou.",
    },
  },
  "auth.invite": {
    en: {
      subject: "You're invited to hackOS",
      body: "Hi,\n\nCreate your account to continue:\n\n[Create account]({{claimUrl}})\n\nSet your password, name and the rest of your details from there.",
    },
    es: {
      subject: "Te han invitado a hackOS",
      body: "Hola,\n\nCrea tu cuenta para continuar:\n\n[Crear cuenta]({{claimUrl}})\n\nDesde ahí fijas tu contraseña, nombre y el resto de tus datos.",
    },
    gl: {
      subject: "Convidáronte a hackOS",
      body: "Ola,\n\nCrea a túa conta para continuar:\n\n[Crear conta]({{claimUrl}})\n\nDende alí fixa o teu contrasinal, nome e o resto dos teus datos.",
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
  "queue.precall": {
    en: {
      subject: "You're up soon",
      body: "Hi {{name}},\n\nYour team {{teamName}} is about {{etaMinutes}} minutes from being called for {{challengeName}}. Start getting ready.",
    },
    es: {
      subject: "Te toca pronto",
      body: "Hola {{name}},\n\nA tu equipo {{teamName}} le llamarán en unos {{etaMinutes}} minutos para {{challengeName}}. Ve preparándote.",
    },
    gl: {
      subject: "Tócache pronto",
      body: "Ola {{name}},\n\nAo teu equipo {{teamName}} chamaranlle en uns {{etaMinutes}} minutos para {{challengeName}}. Vai preparándote.",
    },
  },
  "queue.enter": {
    en: {
      subject: "Come on in",
      body: "Hi {{name}},\n\nIt's your team's turn for {{challengeName}}. Please come in now to room {{roomName}}.",
    },
    es: {
      subject: "Ya puedes entrar",
      body: "Hola {{name}},\n\nEs el turno de tu equipo para {{challengeName}}. Entra ya a la sala {{roomName}}.",
    },
    gl: {
      subject: "Xa podes entrar",
      body: "Ola {{name}},\n\nÉ a quenda do teu equipo para {{challengeName}}. Entra xa á sala {{roomName}}.",
    },
  },
  "queue.staff.enter": {
    en: {
      subject: "Team entering {{roomName}}",
      body: "{{teamName}} was asked to enter room {{roomName}} for {{challengeName}}.",
    },
    es: {
      subject: "Equipo entrando en {{roomName}}",
      body: "Se ha indicado a {{teamName}} que entre en la sala {{roomName}} para {{challengeName}}.",
    },
    gl: {
      subject: "Equipo entrando en {{roomName}}",
      body: "Indicóuselle a {{teamName}} que entre na sala {{roomName}} para {{challengeName}}.",
    },
  },
  "application.decision": {
    en: {
      subject: "A decision on your application",
      body: "Hi {{name}},\n\nYour application to {{applicationName}} has been {{decision}}.{{decisionDetails}}",
    },
    es: {
      subject: "Una decisión sobre tu solicitud",
      body: "Hola {{name}},\n\nTu solicitud a {{applicationName}} ha sido {{decision}}.{{decisionDetails}}",
    },
    gl: {
      subject: "Unha decisión sobre a túa solicitude",
      body: "Ola {{name}},\n\nA túa solicitude a {{applicationName}} foi {{decision}}.{{decisionDetails}}",
    },
  },
  "schedule.reminder": {
    en: {
      subject: "Reminder: {{title}}",
      body: "Hi,\n\n{{title}} starts at {{startsAtLabel}}.{{locationLine}}\n\nSee you there!",
    },
    es: {
      subject: "Recordatorio: {{title}}",
      body: "Hola,\n\n{{title}} empieza a las {{startsAtLabel}}.{{locationLine}}\n\n¡Nos vemos allí!",
    },
    gl: {
      subject: "Lembranza: {{title}}",
      body: "Ola,\n\n{{title}} comeza ás {{startsAtLabel}}.{{locationLine}}\n\nVémonos alí!",
    },
  },
};

/**
 * Compact, action-first copy for time-sensitive queue pushes. Email and inbox
 * keep their fuller context, while a phone's notification header says exactly
 * what the participant needs to do at a glance.
 */
const PUSH_TEMPLATES: Record<string, PushTemplateDefinition> = {
  "queue.staff.enter": {
    en: { title: "{{teamName}} enters {{roomName}}", body: "Called in for {{challengeName}}." },
    es: { title: "{{teamName}} entra en {{roomName}}", body: "Llamado para {{challengeName}}." },
    gl: { title: "{{teamName}} entra en {{roomName}}", body: "Chamado para {{challengeName}}." },
  },
  "queue.called": {
    en: {
      title: "Go wait at room {{roomName}}",
      body: "Wait at the door for {{challengeName}}. We'll tell you when to enter.",
    },
    es: {
      title: "Ve a esperar a la sala {{roomName}}",
      body: "Espera en la puerta para {{challengeName}}. Te avisaremos para entrar.",
    },
    gl: {
      title: "Vai agardar á sala {{roomName}}",
      body: "Agarda na porta para {{challengeName}}. Avisarémoste cando poidas entrar.",
    },
  },
  "queue.enter": {
    en: {
      title: "Enter room {{roomName}} now",
      body: "It's your team's turn for {{challengeName}}.",
    },
    es: {
      title: "Entra ya en la sala {{roomName}}",
      body: "Es el turno de tu equipo para {{challengeName}}.",
    },
    gl: {
      title: "Entra xa na sala {{roomName}}",
      body: "É a quenda do teu equipo para {{challengeName}}.",
    },
  },
  "schedule.reminder": {
    en: {
      title: "{{title}}",
      body: "Starts at {{startsAtLabel}}{{locationSuffix}}",
    },
    es: {
      title: "{{title}}",
      body: "Empieza a las {{startsAtLabel}}{{locationSuffix}}",
    },
    gl: {
      title: "{{title}}",
      body: "Comeza ás {{startsAtLabel}}{{locationSuffix}}",
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
  const rendered = interpolate(variant.body, vars);
  const html = brandWrapHtml(subject, renderBodyHtml(rendered, layout), layout);
  const text = bodyToPlainText(rendered);
  return { subject, html, text };
}

/** Uses action-first push copy when defined, otherwise preserves the email rendering. */
export function renderPushTemplate(payload: EmailPayload, language: Language): RenderedPush {
  const definition = payload.template ? PUSH_TEMPLATES[payload.template] : undefined;
  if (!definition) {
    const rendered = renderEmailTemplate(payload, language);
    return { title: rendered.subject, body: rendered.text };
  }

  const variant = definition[language] ?? definition.en;
  const vars = payload.vars ?? {};
  return {
    title: interpolate(variant.title, vars),
    body: interpolate(variant.body, vars),
  };
}

export const TEMPLATE_NAMES = Object.keys(TEMPLATES);
