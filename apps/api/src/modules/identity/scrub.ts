import type pg from "pg";

import { auditMany } from "../../lib/audit.js";

import { scannerCredentialDigest } from "../logistics/credential-tombstones.js";

import {
  DEFAULT_SUSPICIOUS_GAP_MS,
  guaranteedPresenceMs,
  type PresenceEvent,
} from "../logistics/estimate.js";

import { queueEntryFixtureMarkers } from "../queue/broadcast.js";

import { REPO_MEMBER_RELATION_SQL } from "../queue/membership.js";

import type { DeletedQueueEntryNotification } from "../queue/notify.js";

import type { RunAccountRemovalOptions, UserRemovalRow } from "./types.js";

export async function guaranteedMinutesAtRemoval(
  client: pg.PoolClient,
  userId: number,
): Promise<number> {
  const { rows: timeRows } = await client.query<{ t: string; kind: PresenceEvent["kind"] }>(
    `SELECT extract(epoch FROM scanned_at) * 1000 AS t, kind
       FROM time_logs WHERE user_id = $1 AND kind IN ('in', 'out')
      UNION ALL
     SELECT extract(epoch FROM logged_at) * 1000 AS t, 'activity' AS kind
       FROM activity_logs WHERE user_id = $1`,
    [userId],
  );
  const { rows: eventRows } = await client.query<{ gap: number }>(
    `SELECT presence_certainty_window_minutes AS gap FROM event_config WHERE id = 1`,
  );
  const { rows: nowRows } = await client.query<{ now: Date }>(`SELECT clock_timestamp() AS now`);
  const events = timeRows.map((row) => ({ t: Number(row.t), kind: row.kind }));
  const cutoff = nowRows[0]?.now.getTime() ?? Date.now();
  const gap = Number(eventRows[0]?.gap ?? DEFAULT_SUSPICIOUS_GAP_MS / 60_000) * 60_000;
  return Math.floor(guaranteedPresenceMs(events, cutoff, { suspiciousGapMs: gap }) / 60_000);
}

async function deleteOrphanedProjects(
  client: pg.PoolClient,
  repoIds: number[],
): Promise<DeletedQueueEntryNotification[]> {
  if (repoIds.length === 0) return [];
  const { rows } = await client.query<{ id: number }>(
    `SELECT r.id
       FROM repos r
      WHERE r.id = ANY($1::int[])
        AND NOT EXISTS (
          SELECT 1
            FROM (${REPO_MEMBER_RELATION_SQL}) remaining_members
           WHERE remaining_members.repo_id = r.id
        )`,
    [repoIds],
  );
  const orphanIds = rows.map((row) => row.id);
  if (orphanIds.length === 0) return [];
  const { rows: queueRows } = await client.query<{
    id: number;
    challenge_id: number;
    repo_id: number;
  }>(
    `SELECT id, challenge_id, repo_id
       FROM queue_entries
      WHERE repo_id = ANY($1::int[])
      ORDER BY id
      FOR UPDATE`,
    [orphanIds],
  );
  const queueIds = queueRows.map((row) => row.id);
  const deletedQueueEntries: DeletedQueueEntryNotification[] = [];
  let entryMarkers: Map<number, boolean | null>;
  try {
    entryMarkers = await queueEntryFixtureMarkers(
      client,
      queueRows.map((row) => Number(row.id)),
    );
  } catch {
    // Deletion remains durable, but a malformed graph must never leak an
    // identity-bearing event onto the real operator topic.
    entryMarkers = new Map();
  }
  for (const row of queueRows) {
    const fixtureMarker = entryMarkers.get(Number(row.id)) ?? null;
    deletedQueueEntries.push({
      id: Number(row.id),
      challengeId: Number(row.challenge_id),
      repoId: Number(row.repo_id),
      fixtureMarker,
    });
  }
  if (queueIds.length > 0) {
    await client.query(`DELETE FROM attempt_review_versions WHERE attempt_id = ANY($1::int[])`, [
      queueIds,
    ]);
    await client.query(`DELETE FROM attempt_review WHERE attempt_id = ANY($1::int[])`, [queueIds]);
    await client.query(`DELETE FROM judging_session WHERE queue_entry_id = ANY($1::int[])`, [
      queueIds,
    ]);
    await client.query(`DELETE FROM queue_history WHERE queue_entry_id = ANY($1::int[])`, [
      queueIds,
    ]);
    await client.query(`DELETE FROM queue_entries WHERE id = ANY($1::int[])`, [queueIds]);
  }
  await client.query(`DELETE FROM challenge_winners WHERE repo_id = ANY($1::int[])`, [orphanIds]);
  await client.query(`DELETE FROM submissions WHERE repo_id = ANY($1::int[])`, [orphanIds]);
  await client.query(`DELETE FROM repos WHERE id = ANY($1::int[])`, [orphanIds]);
  return deletedQueueEntries;
}

/**
 * Retire credentials in a global, unlinked denylist. A disconnected scanner
 * can replay an old badge/ticket after its former user row is gone; allowing
 * that credential to be reassigned would make the stale payload resolve to a
 * new participant. The denylist contains no user/application FK and is not an
 * audit subject. Permanent non-reuse is the smallest server-side guarantee
 * that an arbitrarily late offline retry cannot be attributed to somebody
 * else.
 */
async function addScannerTombstones(
  client: pg.PoolClient,
  badgeIds: string[],
  ticketTokens: string[],
): Promise<void> {
  if (badgeIds.length > 0) {
    await client.query(
      `INSERT INTO scanner_revoked_badges (credential_digest, revoked_at)
       SELECT value, clock_timestamp()
         FROM unnest($1::text[]) AS badge_values(value)
       ON CONFLICT (credential_digest) DO UPDATE
         SET revoked_at = EXCLUDED.revoked_at`,
      [badgeIds.map((badgeId) => scannerCredentialDigest("badge", badgeId))],
    );
  }
  if (ticketTokens.length > 0) {
    await client.query(
      `INSERT INTO scanner_revoked_tickets (credential_digest, revoked_at)
       SELECT value, clock_timestamp()
         FROM unnest($1::text[]) AS ticket_values(value)
       ON CONFLICT (credential_digest) DO UPDATE
         SET revoked_at = EXCLUDED.revoked_at`,
      [ticketTokens.map((token) => scannerCredentialDigest("ticket", token))],
    );
  }
}

/**
 * Remove every identity-bearing relationship before deleting the users row.
 * The permanent anonymous subject is created before this scrub, with only the
 * verified-time aggregate and explicitly retained form values. Raw presence
 * and scan rows are deleted after that aggregate is calculated.
 */
export async function scrubRelationships(
  client: pg.PoolClient,
  user: UserRemovalRow,
  preserveIdempotency?: RunAccountRemovalOptions["preserveIdempotency"],
  deletedQueueEntries?: DeletedQueueEntryNotification[],
): Promise<void> {
  const userId = user.id;
  const { rows: historicalEmailRows } = await client.query<{ email: string }>(
    `SELECT email FROM user_email_history WHERE user_id = $1`,
    [userId],
  );
  const emails = [
    ...new Set(
      [user.email, ...historicalEmailRows.map((row) => row.email)].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  ];
  const badgeIds = [user.badge_id, ...(user.badge_id_history ?? [])].filter(
    (value): value is string => Boolean(value),
  );
  const { rows: ticketRows } = await client.query<{ token: string }>(
    `SELECT token FROM tickets WHERE user_id = $1`,
    [userId],
  );
  await addScannerTombstones(
    client,
    [...new Set(badgeIds)],
    ticketRows.map((row) => row.token),
  );

  const { rows: responseRows } = await client.query<{ id: number }>(
    `SELECT id FROM application_responses WHERE user_id = $1`,
    [userId],
  );
  const responseIds = responseRows.map((row) => row.id);
  if (responseIds.length > 0) {
    await client.query(
      `UPDATE application_responses SET referrer_application_id = NULL
        WHERE referrer_application_id = ANY($1::int[])`,
      [responseIds],
    );
    await client.query(`DELETE FROM applicant_reviews WHERE response_id = ANY($1::int[])`, [
      responseIds,
    ]);
    await client.query(`DELETE FROM application_responses WHERE id = ANY($1::int[])`, [
      responseIds,
    ]);
  }

  // No project membership is an audit requirement. Capture every repository
  // linked to the subject before removing the submission row.
  const { rows: membershipRows } = await client.query<{ repo_id: number }>(
    `SELECT repo_id FROM submissions WHERE user_id = $1

     ORDER BY repo_id`,
    [userId],
  );
  const repoIds = membershipRows.map((row) => row.repo_id);
  const submissionAuditEntityIds = repoIds.map((repoId) => `${repoId}:${userId}`);
  const { rows: scheduleOwnerRows } = await client.query<{
    id: number;
    schedule_id: number;
  }>(`SELECT id, schedule_id FROM schedule_owners WHERE user_id = $1`, [userId]);
  const scheduleOwnerAuditEntityIds = scheduleOwnerRows.map(
    (row) => `${row.schedule_id}:${row.id}`,
  );
  // #934: the opted-in public profile is identity-bearing; anonymized rows
  // keep the users row, so the cascade alone would not remove it.
  await client.query(`DELETE FROM user_public_profiles WHERE user_id = $1`, [userId]);
  // H61-H66: the helper card, its knowledge and schedule, and routed-audience
  // rows go. The person's own requests lose their text and requester and
  // are cancelled if still active; a claim held by
  // the person returns to open so the requester can be helped by someone else.
  await client.query(`DELETE FROM help_request_recipients WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM helper_profiles WHERE user_id = $1`, [userId]);
  await client.query(
    `UPDATE help_requests
        SET status = CASE WHEN status IN ('open', 'claimed') THEN 'cancelled' ELSE status END,
            cancelled_at = CASE WHEN status IN ('open', 'claimed') THEN now() ELSE cancelled_at END,
            description = '',
            location = '',
            requester_id = NULL
      WHERE requester_id = $1`,
    [userId],
  );
  await client.query(
    `UPDATE help_requests
        SET status = 'open', claimed_by = NULL, claimed_at = NULL,
            meeting_mode = NULL, meeting_location = NULL
      WHERE claimed_by = $1 AND status = 'claimed'`,
    [userId],
  );
  await client.query(`UPDATE help_requests SET claimed_by = NULL WHERE claimed_by = $1`, [userId]);
  await client.query(`UPDATE help_topics SET proposed_by = NULL WHERE proposed_by = $1`, [userId]);
  // #935: the subject's own event diary, and every entry in other attendees'
  // diaries that points at them.
  await client.query(`DELETE FROM diary_entries WHERE owner_id = $1 OR target_user_id = $1`, [
    userId,
  ]);
  // H18: reports the subject filed and reports about them; staff read the
  // reported content live, so nothing else keeps their identity.
  await client.query(`DELETE FROM content_reports WHERE reporter_id = $1 OR target_user_id = $1`, [
    userId,
  ]);
  await client.query(`DELETE FROM certificate_approvals WHERE user_id = $1`, [userId]);
  // #1083: certificates stay verifiable as revoked, without the person's data.
  await client.query(
    `UPDATE attendance_certificates
        SET snapshot = '{}'::jsonb, recipient_name=NULL, recipient_document_kind=NULL, recipient_document_number=NULL, revoked_at = COALESCE(revoked_at, now()),
            revoked_reason = COALESCE(revoked_reason, 'account_removed')
      WHERE user_id = $1`,
    [userId],
  );
  await client.query(`DELETE FROM project_files WHERE uploaded_by=$1`, [userId]);
  await client.query(
    `UPDATE users SET gallery_show_photo=false,gallery_show_name=false,gallery_consented_at=NULL WHERE id=$1`,
    [userId],
  );
  await client.query(`DELETE FROM submissions WHERE user_id = $1`, [userId]);
  // Invite redemption rows carry personal details outside the audit set. Delete
  // them by their live user FK before deleting the user, since the FK becomes
  // NULL on deletion and would otherwise leave the denormalized details behind.
  await client.query(
    `DELETE FROM enterprise_invite_link_redemptions
      WHERE user_id = $1`,
    [userId],
  );
  await client.query(
    `DELETE FROM user_invite_link_redemptions
      WHERE user_id = $1`,
    [userId],
  );
  const deletedEntries = await deleteOrphanedProjects(client, repoIds);
  deletedQueueEntries?.push(...deletedEntries);

  // Raw accreditation/door rows contain timestamps, methods, notes, badge
  // identifiers, and operator provenance. The permanent audit subject keeps
  // only explicitly retained application values plus verified venue time.
  await client.query(`DELETE FROM check_in_logs WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM time_logs WHERE user_id = $1`, [userId]);
  // Staff provenance is not part of the retained audit subject. Detach it
  // from records belonging to everybody else before deleting this user; the
  // FK is intentionally nullable after H54 (H24, H54).
  await client.query(`UPDATE check_in_logs SET staff_id = NULL WHERE staff_id = $1`, [userId]);
  await client.query(`UPDATE time_logs SET scanned_by = NULL WHERE scanned_by = $1`, [userId]);
  await client.query(`DELETE FROM activity_logs WHERE user_id = $1`, [userId]);
  await client.query(`UPDATE activity_logs SET logged_by = NULL WHERE logged_by = $1`, [userId]);

  if (badgeIds.length > 0) {
    await client.query(`DELETE FROM meal_scan_batch_items WHERE badge_id = ANY($1::text[])`, [
      badgeIds,
    ]);
  }
  await client.query(
    `DELETE FROM meal_scan_batch_items
      WHERE coalesce(result::text, '') ILIKE $1
         OR coalesce(error::text, '') ILIKE $1
         OR coalesce(result::text, '') ILIKE ANY($2::text[])
         OR coalesce(error::text, '') ILIKE ANY($2::text[])`,
    [`%"userId":${userId}%`, emails.map((email) => `%${email}%`)],
  );
  await client.query(`UPDATE meal_scan_batches SET submitted_by = NULL WHERE submitted_by = $1`, [
    userId,
  ]);

  await client.query(`UPDATE user_roles SET assigned_by = NULL WHERE assigned_by = $1`, [userId]);
  await client.query(`UPDATE universities SET proposed_by = NULL WHERE proposed_by = $1`, [userId]);
  await client.query(`UPDATE university_degrees SET proposed_by = NULL WHERE proposed_by = $1`, [
    userId,
  ]);
  await client.query(`UPDATE enterprises SET director_id = NULL WHERE director_id = $1`, [userId]);
  await client.query(`UPDATE enterprise_invite_links SET created_by = NULL WHERE created_by = $1`, [
    userId,
  ]);
  await client.query(`UPDATE user_invite_links SET created_by = NULL WHERE created_by = $1`, [
    userId,
  ]);
  await client.query(`UPDATE room_queue_groups SET assigned_by = NULL WHERE assigned_by = $1`, [
    userId,
  ]);
  await client.query(`UPDATE queue_groups SET created_by = NULL WHERE created_by = $1`, [userId]);
  await client.query(`UPDATE queue_history SET actor_id = NULL WHERE actor_id = $1`, [userId]);
  await client.query(`UPDATE attempt_review_versions SET author_id = NULL WHERE author_id = $1`, [
    userId,
  ]);
  await client.query(`UPDATE judging_session SET judge_id = NULL WHERE judge_id = $1`, [userId]);
  await client.query(`UPDATE food_intolerances SET proposed_by = NULL WHERE proposed_by = $1`, [
    userId,
  ]);
  await client.query(
    `UPDATE application_responses SET referrer_user_id = NULL WHERE referrer_user_id = $1`,
    [userId],
  );
  // Review authorship is identity-bearing and the composite key is NOT NULL;
  // discard reviews this person wrote rather than replacing them with a fake
  // reviewer. Reviews of the departing person's own applications were
  // already deleted with their responses above.
  await client.query(`DELETE FROM applicant_reviews WHERE author_id = $1`, [userId]);
  if (user.is_test_account) {
    // A synthetic announcement's fixture marker is derived from author_id.
    // Detaching that FK would turn fixture content into ordinary staff-facing
    // content, so purge it while the synthetic identity is still attached.
    await client.query(`DELETE FROM announcements WHERE author_id = $1`, [userId]);
  } else {
    await client.query(`UPDATE announcements SET author_id = NULL WHERE author_id = $1`, [userId]);
  }
  await client.query(`UPDATE challenge_versions SET editor_id = NULL WHERE editor_id = $1`, [
    userId,
  ]);
  await client.query(`UPDATE challenge_winners SET set_by = NULL WHERE set_by = $1`, [userId]);
  await client.query(`UPDATE room_enterprises SET assigned_by = NULL WHERE assigned_by = $1`, [
    userId,
  ]);
  // schedule_owners has a CHECK requiring either user_id or free_text_name.
  // A departing account cannot be replaced with its real name, so remove
  // ownership rows for that account and only detach authorship from rows that
  // belong to somebody else (H54).
  await client.query(`DELETE FROM schedule_owners WHERE user_id = $1`, [userId]);
  await client.query(`UPDATE schedule_owners SET assigned_by = NULL WHERE assigned_by = $1`, [
    userId,
  ]);
  await client.query(`UPDATE repos SET created_by = NULL WHERE created_by = $1`, [userId]);
  await client.query(`UPDATE submissions SET invited_by = NULL WHERE invited_by = $1`, [userId]);
  await client.query(`UPDATE enterprise_judges SET added_by = NULL WHERE added_by = $1`, [userId]);

  await client.query(`DELETE FROM enterprise_judges WHERE user_id = $1`, [userId]);
  // A sponsor row can be the required author anchor for a challenge. Keep
  // that organisation-owned row, but sever the person relationship before
  // deleting the account; deleting the row first would violate
  // challenges.author's NO ACTION FK and strand removal_pending accounts.
  await client.query(
    `UPDATE sponsors
        SET user_id = NULL
      WHERE user_id = $1
        AND EXISTS (SELECT 1 FROM challenges WHERE author = sponsors.id)`,
    [userId],
  );
  await client.query(`DELETE FROM sponsors WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM announcement_reads WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM announcement_recipients WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM notification_preferences WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM notification_outbox WHERE user_id = $1`, [userId]);

  await client.query(
    `DELETE FROM wallet_pass_devices
      WHERE pass_id IN (SELECT id FROM wallet_passes WHERE user_id = $1)`,
    [userId],
  );
  await client.query(`DELETE FROM wallet_passes WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM wallet_access_tokens WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM tickets WHERE user_id = $1`, [userId]);
  const normalizedEmails = emails.map((email) => email.toLowerCase());
  await client.query(
    `DELETE FROM email_verification_tokens
      WHERE user_id = $1 OR lower(email) = ANY($2::text[])`,
    [userId, emails.map((email) => email.toLowerCase())],
  );
  await client.query(
    `DELETE FROM verifications
      WHERE lower(identifier) = ANY($2::text[]) OR identifier = $1::text`,
    [userId, normalizedEmails],
  );

  if (user.is_test_account) {
    // DSR fixture visibility is intentionally carried by an identity-free
    // audit marker once the subject FK is scrubbed. Mark every synthetic
    // subject row before either of the updates below can erase that FK, so a
    // pending/processing request cannot become visible or lose its fixture
    // scope before the worker handles it.
    const { rows: syntheticRequestRows } = await client.query<{ id: number }>(
      `SELECT dsr.id
         FROM data_subject_requests dsr
        WHERE dsr.subject_user_id = $1
          AND NOT EXISTS (
            SELECT 1
              FROM audit_log fixture_marker
             WHERE fixture_marker.entity_type = 'data_subject_request'
               AND fixture_marker.entity_id = dsr.id::text
               AND fixture_marker.action = 'fixture_scope_marked'
          )
        FOR UPDATE`,
      [userId],
    );
    await auditMany(
      client,
      syntheticRequestRows.map((request) => ({
        actorId: null,
        entityType: "data_subject_request",
        entityId: request.id,
        action: "fixture_scope_marked",
        source: "system",
        after: { is_test_account: true },
        ip: null,
        userAgent: null,
      })),
    );
  }

  const { rows: completedDeletionRequests } = await client.query<{ id: number }>(
    `UPDATE data_subject_requests
        SET status = 'completed', completed_at = clock_timestamp(), error = NULL,
            subject_user_id = NULL, requested_by = NULL,
            reason = NULL, storage_key = NULL
      WHERE subject_user_id = $1
        AND type = 'deletion'
        AND status = 'processing'
      RETURNING id`,
    [userId],
  );
  // Keep an identity-free completion marker for the DSR admin view. The
  // request row has already lost its subject/requester/reason, and the audit
  // payload contains only its own opaque request id plus the terminal state;
  // it cannot be used as an anonymous-participant mapping.
  await auditMany(
    client,
    completedDeletionRequests.map((request) => ({
      actorId: null,
      entityType: "data_subject_request",
      entityId: request.id,
      action: "deletion_completed",
      source: "system",
      after: { status: "completed" },
      ip: null,
      userAgent: null,
    })),
  );
  await client.query(
    `UPDATE data_subject_requests
        SET subject_user_id = NULL, requested_by = NULL,
            reason = NULL, storage_key = NULL, error = NULL
      WHERE subject_user_id = $1 OR requested_by = $1`,
    [userId],
  );

  // Remove audit/history rows that could reconnect an anonymous row to the
  // old identity. This intentionally sacrifices actor attribution rather than
  // keeping a hidden identity bridge in an audit table.
  // Match user identifiers only when they occur under a user-reference key.
  // Searching for a bare number would delete unrelated audit entries whose
  // challenge, repo, or queue id happens to equal this user's id.
  const idPattern = `"(userId|user_id|subjectUserId|subject_user_id|actorId|actor_id|targetId|target_id|authorId|author_id|judgeId|judge_id|staffId|staff_id|createdBy|created_by|assignedBy|assigned_by|setBy|set_by|linkedBy|linked_by|loggedBy|logged_by|scannedBy|scanned_by|requestedBy|requested_by|submittedBy|submitted_by|referrerUserId|referrer_user_id|directorId|director_id)"[[:space:]]*:[[:space:]]*("${userId}"|${userId})([,}])`;
  const memberIdsPattern = `"memberUserIds"[[:space:]]*:[^]]*(^|[,[])[[:space:]]*"?${userId}"?[[:space:]]*([,]])`;
  // Some older audit producers used a composite entity id such as
  // "repoId:email" instead of putting the email in JSON. These values are
  // still direct identifiers, so scrub them too. DNI is included for the
  // same reason; names are deliberately not searched globally because a
  // common name could delete an unrelated operator's audit row.
  const identityTokens = [...emails, user.dni]
    .filter((value): value is string => Boolean(value))
    .map((value) => `%${value}%`);
  await client.query(
    `WITH removed AS (DELETE FROM audit_log
      WHERE actor_id = $1 OR initiated_by = $1
         OR (
           entity_type = 'application_response'
           AND entity_id = ANY($7::text[])
         )
         OR (
           entity_type = 'submission'
           AND entity_id = ANY($8::text[])
         )
         OR (
           entity_type = 'schedule_owner'
           AND entity_id = ANY($9::text[])
         )
         OR (
           entity_type = ANY($6::text[])
           AND entity_id = $2::text
         )
         OR coalesce(before::text, '') ~ $3
         OR coalesce(after::text, '') ~ $3
         OR coalesce(reason, '') ~ $3
         OR coalesce(before::text, '') ~ $5
         OR coalesce(after::text, '') ~ $5
         OR coalesce(reason, '') ~ $5
         OR coalesce(before::text, '') ILIKE ANY($4::text[])
         OR coalesce(after::text, '') ILIKE ANY($4::text[])
         OR coalesce(reason, '') ILIKE ANY($4::text[])
         OR entity_id ILIKE ANY($4::text[])
       RETURNING id, request_id)
     UPDATE audit_log SET request_id = NULL
       WHERE request_id IN (SELECT request_id FROM removed WHERE request_id IS NOT NULL)
         AND id NOT IN (SELECT id FROM removed)`,
    [
      userId,
      userId,
      idPattern,
      identityTokens,
      memberIdsPattern,
      ["user", "badge", "accreditation", "presence", "meal", "activity"],
      responseIds.map(String),
      submissionAuditEntityIds,
      scheduleOwnerAuditEntityIds,
    ],
  );
  await client.query(
    `DELETE FROM idempotency_keys
      WHERE (
        scope ~ ('(^| )u:' || $1::text || '($| )')
        OR scope LIKE ('DELETE /api/users/' || $1::text || ' %')
        OR scope LIKE ('POST /api/users/' || $1::text || '/anonymize %')
        OR coalesce(response_body::text, '') ILIKE ANY($2::text[])
        OR coalesce(response_body::text, '') ~ $3
        OR coalesce(response_body::text, '') ~ $4
      )
      AND NOT (
        $5::text IS NOT NULL
        AND key = $5
        AND scope = $6
      )`,
    [
      userId,
      identityTokens,
      idPattern,
      memberIdsPattern,
      preserveIdempotency?.key ?? null,
      preserveIdempotency?.completionScope ?? null,
    ],
  );

  await client.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM accounts WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM push_tokens WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM live_activity_devices WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM live_activity_kind_opt_outs WHERE user_id = $1`, [userId]);
  await client.query(`DELETE FROM live_activity_kind_orders WHERE user_id = $1`, [userId]);
}
