import { pool } from "../../src/db/pool.js";
import type { TemplateField } from "../../src/modules/applications/schemas.js";

/** A minimal 2-field template: a required text field and an optional select. */
export function sampleTemplate(): TemplateField[] {
  return [
    {
      key: "motivation",
      label: { en: "Why", es: "Por qué", gl: "Por que" },
      kind: "text",
      required: true,
    },
    {
      key: "credits",
      label: { en: "Credits?", es: "¿Créditos?", gl: "Créditos?" },
      kind: "select",
      required: false,
      options: [
        { value: "yes", label: { en: "Yes", es: "Sí", gl: "Si" } },
        { value: "no", label: { en: "No", es: "No", gl: "Non" } },
      ],
    },
  ];
}

export async function createApplication(
  overrides: Partial<{
    name: string;
    type: string;
    template: TemplateField[];
    active: boolean;
    open_at: string | null;
    close_at: string | null;
    capacity: number | null;
    confirmation_window_hours: number;
  }> = {},
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO applications
       (name, type, template, description, active, open_at, close_at, capacity, confirmation_window_hours)
     VALUES ($1, $2, $3::jsonb, '', $4, $5, $6, $7, $8) RETURNING id`,
    [
      overrides.name ?? "Participant form",
      overrides.type ?? "participant",
      JSON.stringify(overrides.template ?? sampleTemplate()),
      overrides.active ?? true,
      overrides.open_at ?? null,
      overrides.close_at ?? null,
      overrides.capacity ?? null,
      overrides.confirmation_window_hours ?? 168,
    ],
  );
  return rows[0].id;
}

/** Insert a response row directly at a given status (test setup shortcut). */
export async function createResponse(
  userId: number,
  applicationId: number,
  overrides: Partial<{
    status: string;
    responses: Record<string, unknown>;
    decision_sent_at: string | null;
  }> = {},
): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO application_responses (user_id, application_id, status, responses, decision_sent_at)
     VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id`,
    [
      userId,
      applicationId,
      overrides.status ?? "draft",
      JSON.stringify(overrides.responses ?? {}),
      overrides.decision_sent_at ?? null,
    ],
  );
  return rows[0].id;
}

export async function createFoodIntolerance(label: string, proposedBy: number): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO food_intolerances (label, proposed_by) VALUES ($1::jsonb, $2) RETURNING id`,
    [JSON.stringify({ en: label, es: label, gl: label }), proposedBy],
  );
  return rows[0].id;
}

export async function getResponse(id: number): Promise<{
  user_id: number;
  status: string;
  confirmed_at: Date | null;
  declined_at: Date | null;
  decision_sent_at: Date | null;
  confirmation_token_id: number | null;
}> {
  const { rows } = await pool.query(
    `SELECT user_id, status, confirmed_at, declined_at, decision_sent_at, confirmation_token_id
     FROM application_responses WHERE id = $1`,
    [id],
  );
  return rows[0];
}

export async function getUserSensitive(userId: number): Promise<{
  food_intolerances: number[];
  food_intolerance_notes: string | null;
  shirt_size: string | null;
}> {
  const { rows } = await pool.query(
    `SELECT food_intolerances, food_intolerance_notes, shirt_size FROM users WHERE id = $1`,
    [userId],
  );
  return rows[0];
}

/** The active spot_confirmation token for a user (as an email link would carry). */
export async function latestConfirmationToken(userId: number): Promise<string> {
  const { rows } = await pool.query(
    `SELECT token FROM email_verification_tokens
     WHERE user_id = $1 AND type = 'spot_confirmation'
     ORDER BY id DESC LIMIT 1`,
    [userId],
  );
  return rows[0].token;
}

/** Force the confirmation window to have elapsed by back-dating the token + decision. */
export async function expireConfirmationWindow(responseId: number): Promise<void> {
  await pool.query(
    `UPDATE application_responses SET decision_sent_at = now() - interval '1000 hours' WHERE id = $1`,
    [responseId],
  );
  await pool.query(
    `UPDATE email_verification_tokens SET expires_at = now() - interval '1 hour'
     WHERE id = (SELECT confirmation_token_id FROM application_responses WHERE id = $1)`,
    [responseId],
  );
}
