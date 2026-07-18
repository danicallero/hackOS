import type { Queryable } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { BadRequestError, NotFoundError } from "../../lib/errors.js";

export interface AnonymizeUserOptions {
  targetId: number;
  actorId: number | null;
  /** email | web | admin | system */
  source: string;
  reason?: string;
}

/**
 * Scrub every PII column on a user in place (keeping the row + its FK
 * references intact) and revoke all access (sessions + credential accounts).
 * H54 "borrado de datos personales" — accounts that have done things (audit,
 * scans, evaluations…) can't be hard-deleted without corrupting history, so
 * this is the actual deletion mechanism, called both from the direct staff
 * route (POST /api/users/:id/anonymize) and from the data-subject-request
 * workflow. Caller must run this inside a transaction and, once committed,
 * call invalidateCapabilities(targetId).
 */
export async function anonymizeUser(client: Queryable, opts: AnonymizeUserOptions): Promise<void> {
  if (opts.actorId != null && opts.actorId === opts.targetId) {
    throw new BadRequestError("You can't anonymize your own account");
  }
  const { rows } = await client.query(`SELECT id FROM users WHERE id = $1 FOR UPDATE`, [
    opts.targetId,
  ]);
  if (!rows[0]) throw new NotFoundError("User not found", { userId: opts.targetId });
  const anonEmail = `anonymized+${opts.targetId}@deleted.invalid`;
  await client.query(
    `UPDATE users
       SET email = $2, email_verified = false, name = 'Anonymized', surname = NULL,
           phone = NULL, dni = NULL, image = NULL,
           secondary_email = NULL, secondary_email_verified_at = NULL,
           food_intolerances = '{}', food_intolerance_notes = NULL,
           dietary_data_state = 'not_provided', notes = NULL
     WHERE id = $1`,
    [opts.targetId, anonEmail],
  );
  // Revoke all access. Both cascade on user delete anyway, but we remove
  // them explicitly so the anonymized row can no longer authenticate.
  await client.query(`DELETE FROM sessions WHERE user_id = $1`, [opts.targetId]);
  await client.query(`DELETE FROM accounts WHERE user_id = $1`, [opts.targetId]);
  // No `before`: the whole point of anonymizing is erasing PII, so the
  // original email must not be retained anywhere afterward — including here.
  await audit(client, {
    actorId: opts.actorId,
    entityType: "user",
    entityId: opts.targetId,
    action: "anonymized",
    source: opts.source,
    reason: opts.reason,
  });
}
