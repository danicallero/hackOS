import type { Queryable } from "../../db/pool.js";

export type AccountRemovalEligibility =
  | {
      action: "delete";
      reasonCode: "fresh_account";
      accessRevoked: true;
      operationalHistoryRetained: false;
    }
  | {
      action: "anonymize";
      reasonCode: "operational_history";
      accessRevoked: true;
      operationalHistoryRetained: true;
    };

interface RestrictingReference {
  table_schema: string;
  table_name: string;
  column_name: string;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

/**
 * Report whether deleting a user would be blocked by a retained reference.
 *
 * PostgreSQL's restrictive foreign keys are the existing retention policy:
 * references with CASCADE or SET NULL are intentionally removable, while NO
 * ACTION/RESTRICT references preserve operational history. Reading the catalog
 * keeps this preflight aligned when a new retained user reference is added.
 */
// A handful of references are just bookkeeping about the account itself, not
// operational history worth retaining: an applicant who hasn't been
// accredited at check-in yet (no badge, no role) has nothing to keep — even
// with a confirmed spot and a ticket in their wallet — so these are cleaned
// up as part of the delete itself (clearOwnUnretainedReferences) instead of
// blocking it.
//  - application_responses.user_id / applicant_reviews: their own,
//    never-accepted application.
//  - email_verification_tokens.user_id: the claim/verification token that
//    onboarded them (invite accept, secondary email…) — proof of how the
//    account was created, not proof of event participation.
//  - audit_log.actor_id: reachable here only through invite-accept ("accept"
//    audited with actorId = the new user themselves) — since eligibility
//    already requires no capability anywhere, this account was never able to
//    reach a capability-gated route, so it can't hold an audit row about
//    acting on anything BUT its own signup. actor_id is nulled, not deleted,
//    so the audited event itself (entity_type/action/before/after) survives —
//    same as the null actorId a self-delete's own audit row uses.
//  - notification_outbox.user_id: queued/sent comms (e.g. the invite/welcome
//    email) — a message log, not proof of event participation, and nothing
//    else references it.
//  - notification_preferences.user_id: the account's own notification-channel
//    toggles (H51) — a UI setting about how to reach them, not proof of event
//    participation.
//  - tickets.user_id / wallet_passes.user_id: a confirmed spot issues a
//    permanent `tickets` row (plan/07 invariant 10) and, once added to a
//    device wallet, a `ticket`-purpose `wallet_passes` row — neither is
//    presence at the event. The retention boundary is accreditation (badge
//    assignment at check-in), which always writes a `check_in_logs` row
//    first: that row isn't self-cleanable, so it still blocks self-delete on
//    its own once it exists. A `badge`-purpose `wallet_passes` row can only
//    exist after `users.badge_id` is set, which only happens alongside that
//    same `check_in_logs` write — so it's never reachable here either.
// Every other restrictive reference (scans, submissions…) still blocks hard
// delete.
const SELF_CLEANABLE_REFERENCES: ReadonlySet<string> = new Set([
  "application_responses.user_id",
  "email_verification_tokens.user_id",
  "audit_log.actor_id",
  "notification_outbox.user_id",
  "notification_preferences.user_id",
  "tickets.user_id",
  "wallet_passes.user_id",
]);

async function hasRetainedReference(client: Queryable, userId: number): Promise<boolean> {
  const { rows } = await client.query<RestrictingReference>(
    `SELECT child_namespace.nspname AS table_schema,
            child_table.relname AS table_name,
            child_attribute.attname AS column_name
       FROM pg_constraint AS foreign_key
       JOIN pg_class AS parent_table ON parent_table.oid = foreign_key.confrelid
       JOIN pg_namespace AS parent_namespace ON parent_namespace.oid = parent_table.relnamespace
       JOIN pg_class AS child_table ON child_table.oid = foreign_key.conrelid
       JOIN pg_namespace AS child_namespace ON child_namespace.oid = child_table.relnamespace
       JOIN LATERAL unnest(foreign_key.conkey) WITH ORDINALITY
         AS child_key(attribute_number, position) ON true
       JOIN LATERAL unnest(foreign_key.confkey) WITH ORDINALITY
         AS parent_key(attribute_number, position) ON parent_key.position = child_key.position
       JOIN pg_attribute AS child_attribute
         ON child_attribute.attrelid = child_table.oid
        AND child_attribute.attnum = child_key.attribute_number
       JOIN pg_attribute AS parent_attribute
         ON parent_attribute.attrelid = parent_table.oid
        AND parent_attribute.attnum = parent_key.attribute_number
      WHERE foreign_key.contype = 'f'
        AND foreign_key.confdeltype IN ('a', 'r')
        AND parent_namespace.nspname = current_schema()
        AND parent_table.relname = 'users'
        AND parent_attribute.attname = 'id'`,
  );

  for (const reference of rows) {
    if (SELF_CLEANABLE_REFERENCES.has(`${reference.table_name}.${reference.column_name}`)) {
      continue;
    }
    const table = `${quoteIdentifier(reference.table_schema)}.${quoteIdentifier(reference.table_name)}`;
    const column = quoteIdentifier(reference.column_name);
    const result = await client.query(`SELECT 1 FROM ${table} WHERE ${column} = $1 LIMIT 1`, [
      userId,
    ]);
    if (result.rowCount !== null && result.rowCount > 0) return true;
  }
  return false;
}

/**
 * Clear a non-retained applicant's own SELF_CLEANABLE_REFERENCES (H54) so the
 * DELETE FROM users below doesn't hit an FK violation. Only called on the
 * "delete" path — an *accredited* applicant is never eligible here (their
 * check_in_logs row already blocks), so this never touches operational
 * history, even though a confirmed-but-not-yet-accredited holder of a ticket
 * or wallet pass reaches this same path and forfeits their spot.
 */
export async function clearOwnUnretainedReferences(
  client: Queryable,
  userId: number,
): Promise<void> {
  const { rows } = await client.query<{ id: number }>(
    `SELECT id FROM application_responses WHERE user_id = $1`,
    [userId],
  );
  const responseIds = rows.map((row) => row.id);
  if (responseIds.length > 0) {
    await client.query(
      `UPDATE application_responses SET referrer_application_id = NULL
        WHERE referrer_application_id = ANY($1)`,
      [responseIds],
    );
    await client.query(`DELETE FROM applicant_reviews WHERE response_id = ANY($1)`, [responseIds]);
    await client.query(`DELETE FROM application_responses WHERE id = ANY($1)`, [responseIds]);
  }
  await client.query(`DELETE FROM email_verification_tokens WHERE user_id = $1`, [userId]);
  await client.query(`UPDATE audit_log SET actor_id = NULL WHERE actor_id = $1`, [userId]);
  await client.query(`DELETE FROM notification_outbox WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM notification_preferences WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM wallet_passes WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM tickets WHERE user_id = $1`, [userId]);
}

export async function getAccountRemovalEligibility(
  client: Queryable,
  userId: number,
): Promise<AccountRemovalEligibility> {
  if (await hasRetainedReference(client, userId)) {
    return {
      action: "anonymize",
      reasonCode: "operational_history",
      accessRevoked: true,
      operationalHistoryRetained: true,
    };
  }
  return {
    action: "delete",
    reasonCode: "fresh_account",
    accessRevoked: true,
    operationalHistoryRetained: false,
  };
}
