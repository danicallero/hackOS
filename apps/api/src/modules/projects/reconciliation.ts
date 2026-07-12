import type { Queryable } from "../../db/pool.js";

/**
 * Reconcile imported Devpost participants against both account identities:
 * primary email and verified secondary email. Automatic links that no longer
 * match are removed; manual links are never touched. Re-running this also
 * repairs legacy links that are missing their submission.
 */
export async function reconcileDevpostParticipantsForUser(
  client: Queryable,
  userId: number,
): Promise<number> {
  const { rows: identityRows } = await client.query(
    `SELECT lower(email) AS primary_email,
            CASE WHEN secondary_email_verified_at IS NOT NULL
                 THEN lower(secondary_email) END AS verified_secondary_email
       FROM users WHERE id = $1`,
    [userId],
  );
  const identity = identityRows[0] as
    | { primary_email: string; verified_secondary_email: string | null }
    | undefined;
  if (!identity) return 0;
  const emails = [identity.primary_email, identity.verified_secondary_email].filter(
    (email): email is string => email !== null,
  );

  // Changing either identity revokes only automatic links based on an address
  // that is no longer valid. A manually linked participant is an explicit
  // operator decision and must survive later email edits.
  const { rows: removed } = await client.query(
    `UPDATE devpost_participants
        SET user_id = NULL, merge_status = 'unmatched', linked_by = NULL, linked_at = NULL
      WHERE user_id = $1
        AND merge_status = 'auto_matched'
        AND NOT (lower(email) = ANY($2::text[]))
      RETURNING repo_id`,
    [userId, emails],
  );

  await client.query(
    `UPDATE devpost_participants
        SET user_id = $1, merge_status = 'auto_matched'
      WHERE user_id IS NULL
        AND lower(email) = ANY($2::text[])`,
    [userId, emails],
  );

  const { rows: linked } = await client.query(
    `SELECT repo_id, devpost_username
       FROM devpost_participants
      WHERE user_id = $1`,
    [userId],
  );
  for (const row of linked as Array<{ repo_id: number; devpost_username: string | null }>) {
    await client.query(
      `INSERT INTO submissions (repo_id, user_id, imported_from, external_id)
       VALUES ($1, $2, 'devpost', $3)
       ON CONFLICT (repo_id, user_id) DO NOTHING`,
      [row.repo_id, userId, row.devpost_username],
    );
  }

  const removedRepoIds = removed.map((row: { repo_id: number }) => row.repo_id);
  if (removedRepoIds.length > 0) {
    await client.query(
      `DELETE FROM submissions s
        WHERE s.user_id = $1
          AND s.imported_from = 'devpost'
          AND s.repo_id = ANY($2::int[])
          AND NOT EXISTS (
            SELECT 1 FROM devpost_participants dp
             WHERE dp.repo_id = s.repo_id AND dp.user_id = $1
          )`,
      [userId, removedRepoIds],
    );
  }
  return linked.length;
}
