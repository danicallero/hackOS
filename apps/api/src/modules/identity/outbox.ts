import type { Queryable } from "../../db/pool.js";

/**
 * All auth emails (verification H1-H3, reset H5, invites H9/H10) are queued
 * here instead of sent synchronously — the notifications workstream (H50-H52)
 * owns actual delivery via its outbox dispatcher. `category: "auth"` and the
 * template names below match the registry in
 * src/modules/notifications/templates.ts (auth.verify / auth.reset /
 * auth.invite) so the dispatcher renders them with per-user i18n
 * (users.language) without this module knowing anything about email
 * rendering or providers.
 */
export async function enqueueAuthEmail(
  db: Queryable,
  userId: number,
  template: string,
  vars: Record<string, unknown>,
  // `recipient` overrides users.email in the email channel adapter — required
  // whenever the email must go somewhere other than the primary address, e.g.
  // a secondary-email verification (H6) that must reach the NEW address, never
  // the primary one. `language` overrides users.language when known.
  opts: { recipient?: string; language?: string } = {},
): Promise<void> {
  const payload: Record<string, unknown> = { template, vars };
  if (opts.recipient) payload.recipient = opts.recipient;
  if (opts.language) payload.language = opts.language;
  await db.query(
    `INSERT INTO notification_outbox (user_id, category, channel, payload)
     VALUES ($1, 'auth', 'email', $2::jsonb)`,
    [userId, JSON.stringify(payload)],
  );
}
