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
): Promise<void> {
  await db.query(
    `INSERT INTO notification_outbox (user_id, category, channel, payload)
     VALUES ($1, 'auth', 'email', $2::jsonb)`,
    [userId, JSON.stringify({ template, vars })],
  );
}
