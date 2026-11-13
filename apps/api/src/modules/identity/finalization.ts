import { randomUUID } from "node:crypto";

import { hashPassword } from "better-auth/crypto";

import type pg from "pg";

import { audit } from "../../lib/audit.js";

import { ConflictError } from "../../lib/errors.js";

import type { DeletedQueueEntryNotification } from "../queue/notify.js";
import {
  collectExportPrefixes,
  collectStorageKeys,
  collectUploadPrefixes,
  collectWalletArtifacts,
  deleteExternalArtifacts,
} from "./artifacts.js";
import {
  loadUserForRemoval,
  removalDeadlineExpired,
  removalVenueState,
  userHasWildcardRegardlessOfState,
  VERIFIED_PRESENCE_AUDIT_FIELD,
} from "./eligibility.js";
import { purgeReviewFixtureQueuesForUser } from "./review-fixture-queues.js";
import { clearReviewFixtureAuthentication } from "./review-fixture-usage.js";
import { getAssignedRoles } from "./role.js";
import { assertActiveWildcardHolder, lockRoleGraph } from "./role-authority.js";

import { extractAnonymousAuditFields } from "./sanitize.js";

import { guaranteedMinutesAtRemoval, scrubRelationships } from "./scrub.js";

import type {
  AccountRemovalAction,
  AccountRemovalResult,
  AnonymousAuditField,
  RunAccountRemovalOptions,
} from "./types.js";

/**
 * Remove one synthetic reviewer account before replacing a fixture generation.
 * This deliberately reuses the same relationship scrub as self-service
 * removal, including credential tombstones and private-object cleanup. It is
 * admin-only at the route boundary and refuses a real account even if a caller
 * supplies its numeric id. No anonymous id is read or written here.
 */
export async function purgeReviewFixtureAccount(
  client: pg.PoolClient,
  userId: number,
): Promise<void> {
  await lockRoleGraph(client);
  const user = await loadUserForRemoval(client, userId);
  if (!user.is_test_account) {
    throw new ConflictError("Only synthetic review fixture accounts can be regenerated.", {
      code: "review_fixture_required",
    });
  }

  await purgeReviewFixtureQueuesForUser(client, user.id);

  // Run external cleanup before the database scrub commits. If storage is
  // unavailable, the transaction remains intact and the old fixture pointer
  // is still available for a safe retry.
  await deleteExternalArtifacts({
    targetId: user.id,
    action: "delete",
    uploadPrefixes: await collectUploadPrefixes(client, user.id),
    exportPrefixes: await collectExportPrefixes(client, user.id),
    storageKeys: await collectStorageKeys(client, user.id),
    ...(await collectWalletArtifacts(client, user.id)),
    requiresVenueExit: false,
  });

  const wasWildcardHolder = await userHasWildcardRegardlessOfState(client, user.id);
  if (wasWildcardHolder) await assertActiveWildcardHolder(client, user.id);
  await scrubRelationships(client, user);
  // H54: an unavailable fixture must not retain a stale address-use signal.
  await clearReviewFixtureAuthentication(client, user.id);
  await client.query(`DELETE FROM users WHERE id = $1`, [user.id]);
  if (wasWildcardHolder) await assertActiveWildcardHolder(client);
}

/**
 * Reset one synthetic reviewer in place while retaining its login identity.
 * The relationship scrub still removes every generated session, credential,
 * ticket, badge and operational row; the caller then restores only the
 * default Better Auth credential and fixture profile fields.
 */
export async function resetReviewFixtureAccount(
  client: pg.PoolClient,
  userId: number,
  fixture: { email: string; name: string; surname: string; password: string },
): Promise<void> {
  await lockRoleGraph(client);
  const user = await loadUserForRemoval(client, userId);
  if (!user.is_test_account) {
    throw new ConflictError("Only synthetic review fixture accounts can be regenerated.", {
      code: "review_fixture_required",
    });
  }

  const passwordHash = await hashPassword(fixture.password);
  await purgeReviewFixtureQueuesForUser(client, user.id);
  await deleteExternalArtifacts({
    targetId: user.id,
    action: "delete",
    uploadPrefixes: await collectUploadPrefixes(client, user.id),
    exportPrefixes: await collectExportPrefixes(client, user.id),
    storageKeys: await collectStorageKeys(client, user.id),
    ...(await collectWalletArtifacts(client, user.id)),
    requiresVenueExit: false,
  });

  const wasWildcardHolder = await userHasWildcardRegardlessOfState(client, user.id);
  if (wasWildcardHolder) await assertActiveWildcardHolder(client, user.id);
  await scrubRelationships(client, user);
  await client.query(`DELETE FROM user_roles WHERE user_id = $1`, [user.id]);
  await client.query(`DELETE FROM user_email_history WHERE user_id = $1`, [user.id]);
  await client.query(`DELETE FROM activity_rsvps WHERE user_id = $1`, [user.id]);
  await client.query(`DELETE FROM onboarding_step_states WHERE user_id = $1`, [user.id]);
  await client.query(`DELETE FROM mentor_profiles WHERE user_id = $1`, [user.id]);
  await client.query(`DELETE FROM user_role_event_evidence WHERE user_id = $1`, [user.id]);
  await client.query(
    `UPDATE users
        SET email = $2,
            email_verified = true,
            image = NULL,
            photo_key = NULL,
            photo_updated_at = NULL,
            name = $3,
            surname = $4,
            dni = NULL,
            badge_id = NULL,
            badge_id_history = ARRAY[]::text[],
            food_intolerances = ARRAY[]::integer[],
            food_intolerance_notes = NULL,
            dietary_data_state = 'not_provided',
            dietary_confirmed_at = NULL,
            meal_plan_confirmed_at = NULL,
            shirt_size = NULL,
            language = 'en',
            notes = NULL,
            ui_prefs = '{}'::jsonb,
            account_state = 'active',
            removal_action = NULL,
            removal_started_at = NULL,
            removal_requires_exit = false,
            removal_idempotency_key = NULL,
            removal_expires_at = NULL,
            anonymized_at = NULL,
            is_test_account = true
      WHERE id = $1`,
    [user.id, fixture.email, fixture.name, fixture.surname],
  );
  await client.query(
    `INSERT INTO accounts (user_id, account_id, provider_id, password)
     VALUES ($1, $2, 'credential', $3)`,
    [user.id, String(user.id), passwordHash],
  );
  if (wasWildcardHolder) await assertActiveWildcardHolder(client);
}

export async function finalizeAccountRemoval(
  client: pg.PoolClient,
  options: RunAccountRemovalOptions & {
    action: AccountRemovalAction;
    deletedQueueEntries?: DeletedQueueEntryNotification[];
  },
): Promise<AccountRemovalResult> {
  await lockRoleGraph(client);
  const user = await loadUserForRemoval(client, options.targetId);
  if (user.account_state !== "removal_pending" || user.removal_action !== options.action) {
    throw new ConflictError("This account-removal request is not in the expected state.", {
      state: user.account_state,
      action: user.removal_action,
    });
  }
  const venue = await removalVenueState(client, user.id);
  const recoveryExpired = await removalDeadlineExpired(client, user.removal_expires_at);
  if (venue.requiresExit && !recoveryExpired) {
    throw new ConflictError(
      "Close the participant's venue session before finalizing account removal.",
      {
        code: "participant_inside",
      },
    );
  }

  // Synthetic queue/project data is a reviewer fixture, never anonymous audit
  // data. Remove it before the identity scrub so no generated challenge or
  // project can outlive the fixture account.
  await purgeReviewFixtureQueuesForUser(client, user.id);

  const wasWildcardHolder = await userHasWildcardRegardlessOfState(client, user.id);
  let anonymousId: string | null = null;
  let retainedApplicationFields: AnonymousAuditField[] = [];
  let retainedRoleNames: string[] = [];
  if (options.action === "anonymize") {
    anonymousId = randomUUID();
    retainedApplicationFields = await extractAnonymousAuditFields(client, user);
    const guaranteedMinutes = await guaranteedMinutesAtRemoval(client, user.id);
    // H8/H53: the departing identity's own role assignments collapse to
    // visible-only before the users row (and therefore every user_roles row,
    // via ON DELETE CASCADE) is gone below. The org's stated intent is
    // coarse — "I care they were staff", not the granular internal role name
    // a hidden role like "Door Operator" would otherwise carry — so the
    // hidden-role rows are dropped explicitly here and only the visible
    // role names are copied into the permanent anonymous_participant audit
    // trail (below), the one place that outlives this transaction's final
    // DELETE FROM users. This never touches roles this person assigned to
    // OTHERS (assigned_by is nulled separately in scrubRelationships).
    const assignedRoles = await getAssignedRoles(client, user.id);
    retainedRoleNames = assignedRoles.filter((role) => role.isVisible).map((role) => role.name);
    await client.query(
      `DELETE FROM user_roles ur
         USING roles r
        WHERE ur.role_id = r.id AND ur.user_id = $1 AND r.is_visible = false`,
      [user.id],
    );
    await client.query(
      `INSERT INTO anonymous_participants
         (id, guaranteed_presence_minutes, is_test_account)
       VALUES ($1, $2, $3)`,
      [anonymousId, guaranteedMinutes, user.is_test_account],
    );
    if (retainedApplicationFields.length > 0) {
      await client.query(
        `INSERT INTO anonymous_participant_fields
           (anonymous_participant_id, application_id, application_form_version,
            field_key, anonymous_audit_dimension, field_kind, value)
         SELECT $1::uuid, t.application_id, t.form_version, t.field_key, t.dimension,
                t.field_kind, t.value
           FROM unnest($2::int[], $3::int[], $4::text[], $5::text[], $6::text[], $7::jsonb[])
                WITH ORDINALITY AS t(application_id, form_version, field_key, dimension,
                                     field_kind, value, ord)
          ORDER BY t.ord`,
        [
          anonymousId,
          retainedApplicationFields.map((field) => field.applicationId),
          retainedApplicationFields.map((field) => field.applicationFormVersion),
          retainedApplicationFields.map((field) => field.fieldKey),
          retainedApplicationFields.map((field) => field.dimension),
          retainedApplicationFields.map((field) => field.fieldKind),
          retainedApplicationFields.map((field) => JSON.stringify(field.value)),
        ],
      );
    }
  }

  await scrubRelationships(client, user, options.preserveIdempotency, options.deletedQueueEntries);
  const completion = anonymousId
    ? { status: "completed" as const, anonymized: true as const }
    : { status: "completed" as const, deleted: true as const };
  if (options.preserveIdempotency) {
    // A storage/DB failure can return after preparation has revoked access and
    // the original HTTP response is lost. Complete the preserved self-service
    // marker here so the next unauthenticated retry can replay only this
    // boolean result, never the deleted identity (H54).
    await client.query(
      `UPDATE idempotency_keys
          SET response_status = 200, response_body = $3::jsonb, completed_at = clock_timestamp()
        WHERE key = $1 AND scope = $2 AND response_status IS NULL`,
      [
        options.preserveIdempotency.key,
        options.preserveIdempotency.completionScope,
        JSON.stringify(completion),
      ],
    );
  }
  // H54: an unavailable fixture must not retain a stale address-use signal.
  await clearReviewFixtureAuthentication(client, user.id);
  if (user.removal_idempotency_key) {
    const completionScope =
      options.action === "anonymize"
        ? "POST /api/me/anonymize removal-complete"
        : "DELETE /api/me removal-complete";
    await client.query(
      `UPDATE idempotency_keys
          SET response_status = 200, response_body = $2::jsonb, completed_at = clock_timestamp()
        WHERE key = $1 AND scope = $3
          AND (response_status IS NULL OR response_status = 202)`,
      [user.removal_idempotency_key, JSON.stringify(completion), completionScope],
    );
  }
  if (anonymousId) {
    await audit(client, {
      // Self-service removal cannot leave an audit_log.actor_id FK pointing
      // at the row that is deleted immediately below. A null system actor is
      // intentional here; the anonymous row contains no identity bridge.
      actorId: options.actorId === user.id ? null : options.actorId,
      entityType: "anonymous_participant",
      entityId: anonymousId,
      action: "anonymized",
      source: options.source,
      // A request-supplied reason may contain the participant's name, email,
      // or another identifier. Do not create a new identity bridge while
      // recording the identity-free completion event; omit it entirely.
      // H54: this event must not become a new IP/user-agent bridge to the
      // anonymous participant.  The audit helper treats explicit null as a
      // deliberate suppression of request context.
      ip: null,
      userAgent: null,
      after: {
        // H8: the coarse visible-role names this identity held (e.g.
        // "Staff"), never a hidden role's name — those user_roles rows were
        // dropped above rather than copied here.
        retainedRoles: retainedRoleNames,
        retainedFields: [
          ...new Set([
            ...retainedApplicationFields.map((field) => field.dimension ?? field.fieldKey),
            VERIFIED_PRESENCE_AUDIT_FIELD,
          ]),
        ],
      },
    });
  }
  await client.query(`DELETE FROM users WHERE id = $1`, [user.id]);
  if (wasWildcardHolder) await assertActiveWildcardHolder(client);
  return completion;
}
