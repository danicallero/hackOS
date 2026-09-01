import { randomBytes, randomUUID } from "node:crypto";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { firstNumericQuestionKey, type Question } from "@hackos/shared/questions";
import { config } from "../../config.js";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import { assertWithinHackingWindow, isWithinHackingWindow } from "../../lib/hacking-window.js";
import { broadcast } from "../../lib/sse.js";
import { hasMobileAccess } from "../identity/mobile-access.js";
import { enqueueAuthEmail } from "../identity/outbox.js";
import { assertSecondaryEmailAvailable } from "../identity/routes/secondary-email.js";
import {
  assertFixtureQueueScope,
  assertFixtureSubjectScope,
  isSyntheticOperator,
} from "../logistics/review-fixture-scope.js";
import { notify } from "../notifications/service.js";
import {
  broadcastQueueEvent,
  broadcastQueueEventWithMarker,
  queueFixtureMarker,
} from "../queue/broadcast.js";
import { assertQueueChallengeScope, assertQueueRepoScope } from "../queue/fixture-scope.js";
import { writeQueueHistory } from "../queue/history.js";
import { notifyChallengeQueueChanged, repoMemberIds } from "../queue/notify.js";
import { compactQueueGroupPositions, nextBottomPosition } from "../queue/ordering.js";
import { type RepositoryAccessScope, repositoryIdsForScope } from "./access.js";
import { buildImportPlan, type ImportPlan, type PlannedRepo } from "./plan.js";
import { reconcileDevpostParticipantsForUser } from "./reconciliation.js";

const CLAIM_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Read-only: parse + join + match, no writes (H16 "preview must be pure"). */
export async function previewImport(
  projectsCsv: string,
  participantsCsv: string,
): Promise<ImportPlan> {
  return buildImportPlan(pool, projectsCsv, participantsCsv);
}

async function upsertRepo(
  client: Queryable,
  repo: PlannedRepo,
): Promise<{ id: number; wasInsert: boolean }> {
  if (repo.url) {
    const { rows } = await client.query(
      `INSERT INTO repos (name, description, devpost_url, demo_url, github_url)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (devpost_url) WHERE devpost_url IS NOT NULL DO UPDATE
         SET name = EXCLUDED.name,
             description = EXCLUDED.description,
             demo_url = EXCLUDED.demo_url,
             github_url = COALESCE(EXCLUDED.github_url, repos.github_url),
             updated_at = now()
         WHERE repos.is_test_account = false
       RETURNING id, (xmax = 0) AS was_insert`,
      [repo.title, repo.description, repo.url, repo.demoUrl, repo.githubUrl],
    );
    if (!rows[0]) throw new ConflictError("Import cannot overwrite a review-fixture project");
    return { id: rows[0].id, wasInsert: rows[0].was_insert };
  }

  // No Project Url in this row — best-effort dedupe by name among repos
  // that also have no devpost_url (see 0300 migration DELTA note: this
  // case can't use the unique-index upsert, so a second re-import of a
  // URL-less project will only match if the title is identical). Native
  // repos (H18) are excluded: an import must never overwrite a hand-made
  // project that happens to share a title.
  const existing = await client.query(
    `SELECT id FROM repos
      WHERE devpost_url IS NULL AND source = 'devpost' AND is_test_account = false AND name = $1
      LIMIT 1`,
    [repo.title],
  );
  if (existing.rows[0]) {
    await client.query(
      `UPDATE repos SET description = $2, demo_url = $3,
              github_url = COALESCE($4, github_url), updated_at = now()
       WHERE id = $1`,
      [existing.rows[0].id, repo.description, repo.demoUrl, repo.githubUrl],
    );
    return { id: existing.rows[0].id, wasInsert: false };
  }
  const inserted = await client.query(
    `INSERT INTO repos (name, description, devpost_url, demo_url, github_url)
     VALUES ($1, $2, NULL, $3, $4) RETURNING id`,
    [repo.title, repo.description, repo.demoUrl, repo.githubUrl],
  );
  return { id: inserted.rows[0].id, wasInsert: true };
}

export interface ConfirmImportResult {
  batchId: string;
  counts: {
    reposCreated: number;
    reposUpdated: number;
    participantsMatched: number;
    participantsUnmatched: number;
    prizesSeen: number;
    prizesUnmapped: number;
  };
  repos: Array<{ id: number; title: string; action: "create" | "update" }>;
}

/**
 * Writes the import (H16). Idempotent: repos dedupe on devpost_url,
 * devpost_participants on (repo_id, email), repo_devpost_prizes on
 * (repo_id, prize) — re-running with the same files updates rather than
 * duplicates. A row already `manually_linked` (H17) is never overwritten by
 * a later re-import.
 */
export async function confirmImport(
  actorId: number,
  projectsCsv: string,
  participantsCsv: string,
): Promise<ConfirmImportResult> {
  return withTransaction(async (client) => {
    if (await isSyntheticOperator(client, actorId)) {
      throw new ForbiddenError("Review-fixture operators cannot run real Devpost imports", {
        code: "review_fixture_scope",
      });
    }
    const plan = await buildImportPlan(client, projectsCsv, participantsCsv);
    const batchId = `dp_${randomUUID()}`;

    let reposCreated = 0;
    let reposUpdated = 0;
    let participantsMatched = 0;
    let participantsUnmatched = 0;
    const prizeNamesSeen = new Set<string>();
    const repoResults: ConfirmImportResult["repos"] = [];

    for (const repo of plan.repos) {
      const { id: repoId, wasInsert } = await upsertRepo(client, repo);
      if (wasInsert) reposCreated++;
      else reposUpdated++;
      repoResults.push({ id: repoId, title: repo.title, action: wasInsert ? "create" : "update" });

      for (const prizeName of new Set(repo.prizes)) {
        prizeNamesSeen.add(prizeName);
        await client.query(
          `INSERT INTO devpost_prizes (name, last_batch) VALUES ($1, $2)
           ON CONFLICT (name) DO UPDATE SET last_batch = EXCLUDED.last_batch`,
          [prizeName, batchId],
        );
        await client.query(
          `INSERT INTO repo_devpost_prizes (repo_id, prize) VALUES ($1, $2)
           ON CONFLICT (repo_id, prize) DO NOTHING`,
          [repoId, prizeName],
        );
      }

      for (const member of repo.members) {
        await client.query(
          `INSERT INTO devpost_participants
             (repo_id, email, name, surname, devpost_username, user_id, import_batch, merge_status)
           VALUES ($1, $2, $3, $4, $5, $6, $7,
                   CASE WHEN $6::int IS NOT NULL THEN 'auto_matched' ELSE 'unmatched' END)
           ON CONFLICT (repo_id, email) DO UPDATE SET
             name = EXCLUDED.name,
             surname = EXCLUDED.surname,
             devpost_username = EXCLUDED.devpost_username,
             import_batch = EXCLUDED.import_batch,
             -- a manual link (H17) is never clobbered by a later re-import
             user_id = CASE WHEN devpost_participants.merge_status = 'manually_linked'
                            THEN devpost_participants.user_id ELSE EXCLUDED.user_id END,
             merge_status = CASE WHEN devpost_participants.merge_status = 'manually_linked'
                                 THEN devpost_participants.merge_status ELSE EXCLUDED.merge_status END`,
          [
            repoId,
            member.email,
            member.firstName,
            member.lastName,
            member.username,
            member.matchedUserId,
            batchId,
          ],
        );

        const { rows } = await client.query(
          `SELECT user_id FROM devpost_participants WHERE repo_id = $1 AND email = $2`,
          [repoId, member.email],
        );
        const finalUserId: number | null = rows[0]?.user_id ?? null;
        if (finalUserId) {
          participantsMatched++;
          await client.query(
            `INSERT INTO submissions (repo_id, user_id, imported_from, external_id)
             VALUES ($1, $2, 'devpost', $3)
             ON CONFLICT (repo_id, user_id) DO NOTHING`,
            [repoId, finalUserId, member.username],
          );
        } else {
          participantsUnmatched++;
        }
      }
    }

    // H17: surface how many of the prizes this import saw still have no
    // reto mapping, so the "done" screen can point back at the resolution
    // screen even when every participant matched.
    let prizesUnmapped = 0;
    if (prizeNamesSeen.size > 0) {
      const { rows: mappedRows } = await client.query(
        `SELECT devpost_tags FROM challenges WHERE devpost_tags ?| $1::text[]`,
        [[...prizeNamesSeen]],
      );
      const mappedPrizeNames = new Set<string>();
      for (const row of mappedRows as Array<{ devpost_tags: string[] }>) {
        for (const tag of row.devpost_tags) mappedPrizeNames.add(tag);
      }
      prizesUnmapped = [...prizeNamesSeen].filter((name) => !mappedPrizeNames.has(name)).length;
    }

    const counts = {
      reposCreated,
      reposUpdated,
      participantsMatched,
      participantsUnmatched,
      prizesSeen: prizeNamesSeen.size,
      prizesUnmapped,
    };

    await audit(client, {
      actorId,
      entityType: "devpost_import",
      entityId: batchId,
      action: "confirm",
      after: counts,
      source: "admin",
    });

    return { batchId, counts, repos: repoResults };
  });
}

export interface UnmatchedParticipant {
  repo_id: number;
  repo_name: string;
  email: string;
  name: string | null;
  surname: string | null;
  devpost_username: string | null;
  import_batch: string;
  claim_email_sent_at: Date | null;
  created_at: Date;
}

/** H17: participants Devpost brought in whose email matched no account. */
export async function listUnmatchedParticipants(): Promise<UnmatchedParticipant[]> {
  const { rows } = await pool.query(
    `SELECT dp.repo_id, r.name AS repo_name, dp.email, dp.name, dp.surname, dp.devpost_username,
            dp.import_batch, dp.claim_email_sent_at, dp.created_at
     FROM devpost_participants dp
     JOIN repos r ON r.id = dp.repo_id AND r.is_test_account = false
     WHERE dp.merge_status = 'unmatched'
     ORDER BY r.name, dp.email`,
  );
  return rows;
}

export interface ProjectMemberCandidate {
  id: number;
  email: string;
  name: string | null;
  surname: string | null;
}

/** Minimal account lookup for H21 membership edits; does not expose profile data. */
export async function listProjectMemberCandidates(
  query: string,
  limit: number,
  actorId?: number,
): Promise<ProjectMemberCandidate[]> {
  const filter = `%${query.trim()}%`;
  const fixtureMarker = actorId == null ? false : await isSyntheticOperator(pool, actorId);
  const { rows } = await pool.query(
    `SELECT id, email, name, surname
       FROM users
      WHERE account_state = 'active' AND anonymized_at IS NULL
        AND is_test_account = $3
        AND (email ILIKE $1 OR name ILIKE $1 OR surname ILIKE $1)
      ORDER BY name ASC NULLS LAST, surname ASC NULLS LAST, email ASC
      LIMIT $2`,
    [filter, limit, fixtureMarker],
  );
  return rows;
}

export interface LinkResult {
  repoId: number;
  email: string;
  userId: number;
  mergeStatus: "manually_linked";
}

/** H17: operator manually links an unrecognized participant to an account. */
export async function linkParticipant(
  actorId: number,
  repoId: number,
  email: string,
  userId: number,
): Promise<LinkResult> {
  return withTransaction(async (client) => {
    await assertFixtureQueueScope(client, actorId, "repo", repoId);
    const existing = await client.query(
      `SELECT * FROM devpost_participants WHERE repo_id = $1 AND email = $2 FOR UPDATE`,
      [repoId, email],
    );
    if (existing.rows.length === 0) {
      throw new NotFoundError(`No devpost participant ${email} for repo ${repoId}`);
    }
    if (existing.rows[0].merge_status !== "unmatched") {
      throw new ConflictError("Only an unmatched imported participant can be linked", {
        repoId,
        email,
        mergeStatus: existing.rows[0].merge_status,
      });
    }
    const user = await client.query(
      `SELECT id FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (user.rows.length === 0) throw new NotFoundError(`User ${userId} not found`);
    await assertFixtureSubjectScope(client, actorId, userId);

    const before = existing.rows[0];
    await client.query(
      `UPDATE devpost_participants
       SET user_id = $1, merge_status = 'manually_linked', linked_by = $2, linked_at = now()
       WHERE repo_id = $3 AND email = $4`,
      [userId, actorId, repoId, email],
    );
    await client.query(
      `INSERT INTO submissions (repo_id, user_id, imported_from, external_id)
       VALUES ($1, $2, 'devpost', $3)
       ON CONFLICT (repo_id, user_id) DO NOTHING`,
      [repoId, userId, before.devpost_username],
    );
    await audit(client, {
      actorId,
      entityType: "devpost_participant",
      entityId: `${repoId}:${email}`,
      action: "manual_link",
      before: { mergeStatus: before.merge_status, userId: before.user_id },
      after: { mergeStatus: "manually_linked", userId },
      source: "admin",
    });
    return { repoId, email, userId, mergeStatus: "manually_linked" as const };
  });
}

export interface LinkSecondaryResult {
  repoId: number;
  email: string;
  userId: number;
  /** False when the Devpost address is already the account's primary address. */
  secondaryEmailSent: boolean;
  /** Membership is only active once the address is a verified identity. */
  linked: boolean;
  mergeStatus: "auto_matched" | "unmatched";
}

const SECONDARY_EMAIL_TTL_HOURS = 24;

/**
 * H6/H16: link an unmatched Devpost email to a hackOS account by registering
 * it as that account's SECONDARY email and firing the platform's normal
 * secondary-email verification (identity, H6) — we do NOT invent a new flow.
 * The participant stays unmatched until the account holder verifies the new
 * address. Verification invokes reconciliation and creates the membership.
 * This makes the link revocable when the secondary address is replaced or
 * removed. An address that is already the account's primary identity is
 * reconciled immediately and remains an automatic match.
 */
export async function linkParticipantSecondary(
  actorId: number,
  repoId: number,
  email: string,
  userId: number,
): Promise<LinkSecondaryResult> {
  let secondaryEmailSent = false;
  let linked = false;
  await withTransaction(async (client) => {
    await assertFixtureQueueScope(client, actorId, "repo", repoId);
    const participant = await client.query(
      `SELECT * FROM devpost_participants WHERE repo_id = $1 AND email = $2 FOR UPDATE`,
      [repoId, email],
    );
    if (participant.rows.length === 0) {
      throw new NotFoundError(`No devpost participant ${email} for repo ${repoId}`);
    }
    if (participant.rows[0].merge_status !== "unmatched") {
      throw new ConflictError("Only an unmatched imported participant can start identity linking", {
        repoId,
        email,
        mergeStatus: participant.rows[0].merge_status,
      });
    }
    const userRes = await client.query(
      `SELECT id, email, name FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    const user = userRes.rows[0] as { id: number; email: string; name: string | null } | undefined;
    if (!user) throw new NotFoundError(`User ${userId} not found`);
    await assertFixtureSubjectScope(client, actorId, userId);

    const isPrimaryEmail = user.email.toLowerCase() === email;
    secondaryEmailSent = !isPrimaryEmail;
    if (!isPrimaryEmail) {
      // Uniqueness rule (H6), checked before we touch anything — explicit 409.
      await assertSecondaryEmailAvailable(email, userId, client);
      const token = randomBytes(32).toString("base64url");

      // A new request supersedes any pending unverified token for this user.
      await client.query(
        `UPDATE email_verification_tokens SET used_at = now()
         WHERE user_id = $1 AND type = 'secondary_email' AND used_at IS NULL`,
        [userId],
      );
      await client.query(
        `INSERT INTO email_verification_tokens (token, type, email, user_id, expires_at)
         VALUES ($1, 'secondary_email', $2, $3, now() + make_interval(hours => $4))`,
        [token, email, userId, SECONDARY_EMAIL_TTL_HOURS],
      );
      // Pending (not yet verified) address is stored so /me can show it.
      await client.query(
        `UPDATE users SET secondary_email = $2, secondary_email_verified_at = NULL WHERE id = $1`,
        [userId, email],
      );
      await reconcileDevpostParticipantsForUser(client, userId);
      await enqueueAuthEmail(
        client,
        userId,
        "auth.verify",
        {
          name: user.name ?? "",
          verifyUrl: `${config.WEB_URL}/verify-secondary-email?token=${token}`,
        },
        // H6: the verification MUST reach the newly added secondary address.
        { recipient: email },
      );
    }

    const before = participant.rows[0];
    if (isPrimaryEmail) {
      await reconcileDevpostParticipantsForUser(client, userId);
      linked = true;
    }
    await audit(client, {
      actorId,
      entityType: "devpost_participant",
      entityId: `${repoId}:${email}`,
      action: "secondary_email_link_requested",
      before: { mergeStatus: before.merge_status, userId: before.user_id },
      after: {
        mergeStatus: isPrimaryEmail ? "auto_matched" : "unmatched",
        userId: isPrimaryEmail ? userId : null,
        secondaryEmailSent: !isPrimaryEmail,
      },
      source: "admin",
    });
  });

  return {
    repoId,
    email,
    userId,
    secondaryEmailSent,
    linked,
    mergeStatus: linked ? "auto_matched" : "unmatched",
  };
}

export interface ClaimEmailResult {
  repoId: number;
  email: string;
  sent: true;
  expiresAt: Date;
}

/**
 * H17: fires an account-claim invite for an unmatched participant. Creates
 * the email_verification_tokens row + a notification_outbox email job. The
 * actual claim-completion endpoint (setting a password, finishing the
 * account) belongs to the identity workstream — not implemented here.
 *
 * notification_outbox.user_id is NOT NULL, and this participant has no
 * account yet, so a bare-bones `users` stub row (email only, unverified) is
 * created to hang the notification off — mirroring how H10's admin-invited
 * accounts exist before the invitee ever logs in. If the participant later
 * shows up again in a re-import with the same email, they'll now
 * auto-match to this stub (which is the desired outcome: claiming finishes
 * the same account instead of forking a second one).
 */
export async function sendClaimEmail(
  actorId: number,
  repoId: number,
  email: string,
): Promise<ClaimEmailResult> {
  return withTransaction(async (client) => {
    await assertFixtureQueueScope(client, actorId, "repo", repoId);
    const fixtureMarker = await isSyntheticOperator(client, actorId);
    const participant = await client.query(
      `SELECT * FROM devpost_participants WHERE repo_id = $1 AND email = $2 FOR UPDATE`,
      [repoId, email],
    );
    if (participant.rows.length === 0) {
      throw new NotFoundError(`No devpost participant ${email} for repo ${repoId}`);
    }
    if (participant.rows[0].merge_status !== "unmatched") {
      throw new ConflictError(
        `Participant ${email} is already ${participant.rows[0].merge_status}, not unmatched`,
      );
    }

    let userId: number;
    const existingUser = await client.query(
      `SELECT id, account_state, is_test_account FROM users WHERE email = $1 FOR UPDATE`,
      [email],
    );
    if (existingUser.rows[0]) {
      if (existingUser.rows[0].account_state !== "active") {
        throw new ConflictError("This account is already being removed", { email });
      }
      await assertFixtureSubjectScope(client, actorId, Number(existingUser.rows[0].id));
      userId = existingUser.rows[0].id;
    } else {
      const created = await client.query(
        `INSERT INTO users (email, email_verified, is_test_account)
         VALUES ($1, false, $2) RETURNING id`,
        [email, fixtureMarker],
      );
      userId = created.rows[0].id;
    }

    const token = randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + CLAIM_TOKEN_TTL_MS);
    await client.query(
      `INSERT INTO email_verification_tokens (token, type, email, user_id, expires_at)
       VALUES ($1, 'account_claim', $2, $3, $4)`,
      [token, email, userId, expiresAt],
    );
    await client.query(
      `INSERT INTO notification_outbox (user_id, category, channel, payload)
       VALUES ($1, 'devpost', 'email', $2::jsonb)`,
      [
        userId,
        JSON.stringify({ template: "devpost_account_claim", recipient: email, token, repoId }),
      ],
    );
    await client.query(
      `UPDATE devpost_participants SET claim_email_sent_at = now() WHERE repo_id = $1 AND email = $2`,
      [repoId, email],
    );
    await audit(client, {
      actorId,
      entityType: "devpost_participant",
      entityId: `${repoId}:${email}`,
      action: "claim_email_sent",
      after: { email, userId, expiresAt },
      source: "admin",
    });

    return { repoId, email, sent: true, expiresAt };
  });
}

export interface MapPrizeResult {
  challengeId: number;
  prize: string;
  repoCount: number;
  repoIds: number[];
}

/**
 * Prize -> challenge mapping helper. Appends to challenges.devpost_tags and
 * reports how many already-imported repos carry that prize — but does NOT
 * create queue_entries (that's the queue workstream's call once they decide
 * to enqueue these repos).
 */
export async function mapPrizeToChallenge(
  actorId: number,
  prizeName: string,
  challengeId: number,
): Promise<MapPrizeResult> {
  return withTransaction(async (client) => {
    await assertFixtureQueueScope(client, actorId, "challenge", challengeId);
    const challenge = await client.query(
      `SELECT id, devpost_tags, is_test_account FROM challenges WHERE id = $1 FOR UPDATE`,
      [challengeId],
    );
    if (challenge.rows.length === 0) throw new NotFoundError(`Challenge ${challengeId} not found`);

    const tags: string[] = challenge.rows[0].devpost_tags ?? [];
    if (!tags.includes(prizeName)) {
      await client.query(
        `UPDATE challenges SET devpost_tags = devpost_tags || $2::jsonb WHERE id = $1`,
        [challengeId, JSON.stringify([prizeName])],
      );
    }

    const repos = await client.query(
      `SELECT rdp.repo_id
         FROM repo_devpost_prizes rdp
         JOIN repos r ON r.id = rdp.repo_id
        WHERE rdp.prize = $1 AND r.is_test_account = $2`,
      [prizeName, challenge.rows[0].is_test_account === true],
    );
    const repoIds = repos.rows.map((r: { repo_id: number }) => r.repo_id);

    await audit(client, {
      actorId,
      entityType: "challenge",
      entityId: challengeId,
      action: "map_devpost_prize",
      after: { prize: prizeName, repoCount: repoIds.length },
      source: "admin",
    });

    return { challengeId, prize: prizeName, repoCount: repoIds.length, repoIds };
  });
}

interface RepoRow {
  id: number;
  name: string;
  description: string;
  github_url: string | null;
  devpost_url: string | null;
  demo_url: string | null;
  source: "devpost" | "native";
}

interface RepoMember {
  userId: number | null;
  /** null when the caller is not entitled to a teammate's address (H20). */
  email: string | null;
  name: string | null;
  surname: string | null;
  mergeStatus: string;
  matchType: "primary_email" | "secondary_email" | "manual" | "unmatched";
  devpostUsername: string | null;
}

interface RepoChallenge {
  id: number;
  title: string;
  status: string | null;
  position: number | null;
  assignedRoomId: number | null;
  assignedRoomName: string | null;
  mappedPrizes: string[];
  source: "queue" | "prize" | "queue_and_prize";
  /** H36 evaluation status — null both when unevaluated AND when the caller
   * has no visibility into this challenge (see visibleChallengeIds below). */
  reviewStatus: "draft" | "submitted" | null;
  nota: number | null;
}

interface RepoWithExtras extends RepoRow {
  members: RepoMember[];
  prizes: string[];
  unmappedPrizes: string[];
  challenges: RepoChallenge[];
}

/**
 * PROJECTS_READ attachments (H16). Members are EVERY imported Devpost
 * participant — matched and unmatched alike (req: "store ALL member emails")
 * — so operators can see who still needs linking. Challenges include both
 * prize-mapped participation and live queue membership so project detail hot
 * edits are visible immediately after adding a challenge.
 *
 * `visibleChallengeIds` gates the H36 evaluation fields (reviewStatus/nota)
 * per challenge entry: "all" for full-access staff, or the exact set of
 * challenge ids the caller may see review data for (their own sponsor
 * enterprise's challenges, or the challenges they judge). Entries outside
 * that set come back with reviewStatus/nota = null — indistinguishable from
 * "not evaluated yet" — so a sponsor can't infer anything about another
 * company's judging progress from their own project view.
 */
async function attachMembersAndPrizes(
  repoRows: RepoRow[],
  visibleChallengeIds: number[] | "all" = "all",
  fixtureMarker = false,
): Promise<RepoWithExtras[]> {
  const ids = repoRows.map((r) => r.id);
  if (ids.length === 0) return [];
  const visibleSet = visibleChallengeIds === "all" ? null : new Set(visibleChallengeIds);

  const membersRes = await pool.query(
    `SELECT dp.repo_id, dp.email, dp.name, dp.surname, dp.devpost_username,
            dp.user_id, dp.merge_status,
            CASE
              WHEN dp.user_id IS NULL THEN 'unmatched'
              WHEN lower(dp.email) = lower(u.email) THEN 'primary_email'
              WHEN u.secondary_email_verified_at IS NOT NULL
                AND lower(dp.email) = lower(u.secondary_email) THEN 'secondary_email'
              ELSE 'manual'
            END AS match_type
       FROM devpost_participants dp
       LEFT JOIN users u ON u.id = dp.user_id
      WHERE repo_id = ANY($1::int[])
        AND (u.id IS NULL OR (u.account_state = 'active' AND u.anonymized_at IS NULL AND u.is_test_account = $2))
      ORDER BY repo_id, name ASC NULLS LAST, surname ASC NULLS LAST, email ASC`,
    [ids, fixtureMarker],
  );
  const manualMembersRes = await pool.query(
    `SELECT s.repo_id, u.id AS user_id, u.email, u.name, u.surname
       FROM submissions s
       JOIN users u ON u.id = s.user_id
      WHERE s.repo_id = ANY($1::int[])
        -- H19/H20: a pending invite (status='invited') is not yet a member
        -- of the roster — it only shows up via myPendingInvites/GET
        -- /api/me/projects/invites until accepted.
        AND s.status = 'active'
        AND u.account_state = 'active' AND u.anonymized_at IS NULL
        AND u.is_test_account = $2
        AND NOT EXISTS (
          SELECT 1
            FROM devpost_participants dp
           WHERE dp.repo_id = s.repo_id
             AND dp.user_id = s.user_id
        )
      ORDER BY s.repo_id, u.name ASC NULLS LAST, u.surname ASC NULLS LAST, u.email ASC`,
    [ids, fixtureMarker],
  );
  const prizesRes = await pool.query(
    `SELECT p.repo_id, p.prize
       FROM repo_devpost_prizes p
       JOIN repos r ON r.id = p.repo_id AND r.is_test_account = $2
      WHERE p.repo_id = ANY($1::int[])
      ORDER BY p.repo_id, p.prize ASC`,
    [ids, fixtureMarker],
  );
  const prizeNames = [...new Set(prizesRes.rows.map((r: { prize: string }) => r.prize))];
  const challengesRes = prizeNames.length
    ? await pool.query(
        `SELECT id, title, devpost_tags FROM challenges
          WHERE devpost_tags ?| $1::text[] AND is_test_account = $2`,
        [prizeNames, fixtureMarker],
      )
    : { rows: [] as Array<{ id: number; title: string; devpost_tags: string[] }> };

  const challengesByPrize = new Map<string, Array<{ id: number; title: string }>>();
  const mappedPrizes = new Set<string>();
  for (const c of challengesRes.rows as Array<{
    id: number;
    title: string;
    devpost_tags: string[];
  }>) {
    for (const tag of c.devpost_tags) {
      if (!prizeNames.includes(tag)) continue;
      const arr = challengesByPrize.get(tag) ?? [];
      arr.push({ id: c.id, title: c.title });
      challengesByPrize.set(tag, arr);
      mappedPrizes.add(tag);
    }
  }

  const queueRes = await pool.query(
    `SELECT qe.repo_id, qe.challenge_id AS id, c.title, qe.status, qe.position,
            qe.assigned_room_id, r.name AS assigned_room_name,
            c.judging_panel_criteria, ar.status AS review_status, ar.scores AS review_scores
       FROM queue_entries qe
       JOIN challenges c ON c.id = qe.challenge_id AND c.is_test_account = $2
       JOIN repos repo ON repo.id = qe.repo_id AND repo.is_test_account = $2
       LEFT JOIN rooms r ON r.id = qe.assigned_room_id
       LEFT JOIN attempt_review ar ON ar.attempt_id = qe.id
      WHERE qe.repo_id = ANY($1::int[])
        AND qe.status NOT IN ('cancelled', 'disqualified')
      ORDER BY qe.repo_id, qe.position ASC NULLS LAST, qe.id ASC`,
    [ids, fixtureMarker],
  );

  const membersByRepo = new Map<number, RepoMember[]>();
  for (const row of membersRes.rows as Array<{
    repo_id: number;
    email: string;
    name: string | null;
    surname: string | null;
    devpost_username: string | null;
    user_id: number | null;
    merge_status: string;
    match_type: RepoMember["matchType"];
  }>) {
    const arr = membersByRepo.get(row.repo_id) ?? [];
    arr.push({
      userId: row.user_id,
      email: row.email,
      name: row.name,
      surname: row.surname,
      mergeStatus: row.merge_status,
      matchType: row.match_type,
      devpostUsername: row.devpost_username,
    });
    membersByRepo.set(row.repo_id, arr);
  }
  for (const row of manualMembersRes.rows as Array<{
    repo_id: number;
    user_id: number;
    email: string;
    name: string | null;
    surname: string | null;
  }>) {
    const arr = membersByRepo.get(row.repo_id) ?? [];
    arr.push({
      userId: row.user_id,
      email: row.email,
      name: row.name,
      surname: row.surname,
      mergeStatus: "manual",
      matchType: "manual",
      devpostUsername: null,
    });
    membersByRepo.set(row.repo_id, arr);
  }

  const prizesByRepo = new Map<number, string[]>();
  for (const p of prizesRes.rows as Array<{ repo_id: number; prize: string }>) {
    const arr = prizesByRepo.get(p.repo_id) ?? [];
    arr.push(p.prize);
    prizesByRepo.set(p.repo_id, arr);
  }

  const queueChallengesByRepo = new Map<number, RepoChallenge[]>();
  for (const row of queueRes.rows as Array<{
    repo_id: number;
    id: number;
    title: string;
    status: string;
    position: number | null;
    assigned_room_id: number | null;
    assigned_room_name: string | null;
    judging_panel_criteria: unknown;
    review_status: "draft" | "submitted" | null;
    review_scores: Record<string, unknown> | null;
  }>) {
    const canSeeReview = visibleSet === null || visibleSet.has(row.id);
    let nota: number | null = null;
    if (canSeeReview && row.review_scores && Array.isArray(row.judging_panel_criteria)) {
      const notaKey = firstNumericQuestionKey(row.judging_panel_criteria as Question[]);
      const value = notaKey ? row.review_scores[notaKey] : undefined;
      if (typeof value === "number") nota = value;
    }
    const arr = queueChallengesByRepo.get(row.repo_id) ?? [];
    arr.push({
      id: row.id,
      title: row.title,
      status: row.status,
      position: row.position,
      assignedRoomId: row.assigned_room_id,
      assignedRoomName: row.assigned_room_name,
      mappedPrizes: [],
      source: "queue",
      reviewStatus: canSeeReview ? (row.review_status ?? null) : null,
      nota,
    });
    queueChallengesByRepo.set(row.repo_id, arr);
  }

  return repoRows.map((repo) => {
    const prizes = prizesByRepo.get(repo.id) ?? [];
    const challengesSeen = new Map<number, RepoChallenge>();
    for (const prize of prizes) {
      for (const c of challengesByPrize.get(prize) ?? []) {
        const existing = challengesSeen.get(c.id);
        if (existing) {
          existing.mappedPrizes.push(prize);
          continue;
        }
        challengesSeen.set(c.id, {
          id: c.id,
          title: c.title,
          status: null,
          position: null,
          assignedRoomId: null,
          assignedRoomName: null,
          mappedPrizes: [prize],
          source: "prize",
          reviewStatus: null,
          nota: null,
        });
      }
    }
    for (const c of queueChallengesByRepo.get(repo.id) ?? []) {
      const existing = challengesSeen.get(c.id);
      if (existing) {
        challengesSeen.set(c.id, {
          ...existing,
          status: c.status,
          position: c.position,
          assignedRoomId: c.assignedRoomId,
          assignedRoomName: c.assignedRoomName,
          source: "queue_and_prize",
          reviewStatus: c.reviewStatus,
          nota: c.nota,
        });
        continue;
      }
      challengesSeen.set(c.id, c);
    }
    return {
      ...repo,
      members: membersByRepo.get(repo.id) ?? [],
      prizes,
      unmappedPrizes: prizes.filter((prize) => !mappedPrizes.has(prize)),
      challenges: [...challengesSeen.values()],
    };
  });
}

const REPO_SELECT = `SELECT id, name, description, github_url, devpost_url, demo_url, source FROM repos`;

/** PROJECTS_READ: repos with members, prizes, and mapped challenges. */
export async function listRepos(fixtureMarker = false): Promise<RepoWithExtras[]> {
  const { rows } = await pool.query(`${REPO_SELECT} WHERE is_test_account = $1 ORDER BY name`, [
    fixtureMarker,
  ]);
  return attachMembersAndPrizes(rows, "all", fixtureMarker);
}

export async function getRepo(id: number, fixtureMarker = false): Promise<RepoWithExtras> {
  const { rows } = await pool.query(`${REPO_SELECT} WHERE is_test_account = $2 AND id = $1`, [
    id,
    fixtureMarker,
  ]);
  if (rows.length === 0) throw new NotFoundError(`Repo ${id} not found`);
  const [withExtras] = await attachMembersAndPrizes(rows, "all", fixtureMarker);
  if (!withExtras) throw new NotFoundError(`Repo ${id} not found`);
  return withExtras;
}

/** Repos visible under the shared repository policy's resolved scope. */
export async function listReposForScope(scope: RepositoryAccessScope): Promise<RepoWithExtras[]> {
  if (scope.fullAccess) return listRepos(scope.fixtureMarker === true);
  const repoIds = await repositoryIdsForScope(scope);
  if (repoIds.length === 0) return [];
  const { rows } = await pool.query(
    `${REPO_SELECT} WHERE is_test_account = $2 AND id = ANY($1::int[]) ORDER BY name`,
    [repoIds, scope.fixtureMarker === true],
  );
  // Evaluation visibility is capped to this caller's own challenges (their
  // sponsor enterprise's, or the ones they judge) — never another sponsor's.
  return attachMembersAndPrizes(rows, scope.challengeIds, scope.fixtureMarker === true);
}

/** A repository already authorized by the shared contextual policy. */
export async function getRepoForScope(
  id: number,
  scope: RepositoryAccessScope,
): Promise<RepoWithExtras> {
  if (scope.fullAccess) return getRepo(id, scope.fixtureMarker === true);
  const { rows } = await pool.query(`${REPO_SELECT} WHERE is_test_account = $2 AND id = $1`, [
    id,
    scope.fixtureMarker === true,
  ]);
  if (!rows[0]) throw new NotFoundError(`Repo ${id} not found`);
  const [repo] = await attachMembersAndPrizes(
    rows,
    scope.challengeIds,
    scope.fixtureMarker === true,
  );
  if (!repo) throw new NotFoundError(`Repo ${id} not found`);
  return repo;
}

/**
 * Participant self-view (H20): repos this user is a member of, WITH the team
 * roster and challenge lineup — the story is "ver mi proyecto, su equipo y a
 * qué retos se presenta". Read-only: any correction goes through queue
 * management (H21) or, when the event enables it, self-creation (H19).
 *
 * Membership must match what every other project/queue roster surfaces via
 * attachMembersAndPrizes — a user counts as a member if they have a submission
 * OR are a matched Devpost participant (`devpost_participants.user_id`).
 * `removeRepoMember` clears that link when it removes the corresponding
 * submission, so all membership surfaces stop agreeing that the user belongs to
 * the project at the same time.
 */
/**
 * H55/nav: cheap existence check backing the "My project" nav item — same
 * membership definition as {@link myProjects}, without the roster join.
 */
export async function hasMyProject(userId: number): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM submissions s
        JOIN repos r ON r.id = s.repo_id
        JOIN users u ON u.id = s.user_id
        WHERE s.user_id = $1 AND s.status = 'active'
          AND r.is_test_account = u.is_test_account
       UNION
       SELECT 1 FROM devpost_participants dp
        JOIN repos r ON r.id = dp.repo_id
        JOIN users u ON u.id = dp.user_id
        WHERE dp.user_id = $1 AND r.is_test_account = u.is_test_account
     ) AS exists`,
    [userId],
  );
  return rows[0].exists as boolean;
}

export async function myProjects(userId: number): Promise<RepoWithExtras[]> {
  const { rows: userRows } = await pool.query<{ is_test_account: boolean }>(
    `SELECT is_test_account FROM users WHERE id = $1`,
    [userId],
  );
  const fixtureMarker = userRows[0]?.is_test_account === true;
  const { rows } = await pool.query(
    `SELECT r.id, r.name, r.description, r.github_url, r.devpost_url, r.demo_url, r.source
     FROM repos r
     WHERE r.is_test_account = $2 AND r.id IN (
       -- H19/H20: a project the caller was merely invited to (status='invited')
       -- is not "my project" yet — it only shows via myPendingInvites until
       -- they accept it.
       SELECT repo_id FROM submissions WHERE user_id = $1 AND status = 'active'
       UNION
       SELECT repo_id FROM devpost_participants WHERE user_id = $1
     )
     ORDER BY r.name`,
    [userId, fixtureMarker],
  );
  // H20 is read-only self-view — participants never see judging internals.
  const repos = await attachMembersAndPrizes(rows, [], fixtureMarker);
  // A teammate's address is not the participant's to read: only the caller's
  // own email survives the self-view (H20).
  return repos.map((repo) => ({
    ...repo,
    members: repo.members.map((m) => (m.userId === userId ? m : { ...m, email: null })),
  }));
}

/**
 * H19/H20 self-service eligibility: reuses the mobile-access "admitted
 * attendee" check verbatim (accepted/confirmed applicant, or an operational
 * relationship) rather than reimplementing the underlying SQL.
 */
export async function isAdmittedParticipant(db: Queryable, userId: number): Promise<boolean> {
  return hasMobileAccess(db, userId);
}

/**
 * True when userId is a non-invited member of repoId — either an 'active'
 * `submissions` row or a matched Devpost participant. Mirrors the membership
 * definition `myProjects`/`attachMembersAndPrizes` already use, minus rows
 * still awaiting an invite response (H19/H20).
 */
export async function isActiveProjectMember(
  db: Queryable,
  repoId: number,
  userId: number,
): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT (
       EXISTS (
         SELECT 1 FROM submissions s
          JOIN repos r ON r.id = s.repo_id
          JOIN users u ON u.id = s.user_id
          WHERE s.repo_id = $1 AND s.user_id = $2 AND s.status = 'active'
            AND u.account_state = 'active' AND u.anonymized_at IS NULL
            AND r.is_test_account = u.is_test_account
       )
       OR EXISTS (
         SELECT 1 FROM devpost_participants dp
          JOIN repos r ON r.id = dp.repo_id
          JOIN users u ON u.id = dp.user_id
          WHERE dp.repo_id = $1 AND dp.user_id = $2
            AND u.account_state = 'active' AND u.anonymized_at IS NULL
            AND r.is_test_account = u.is_test_account
       )
     ) AS member`,
    [repoId, userId],
  );
  return rows[0]?.member === true;
}

/** Distinct active-member count for repoId; used by leave/delete to detect "last member" (H19/H20). */
export async function activeProjectMemberCount(db: Queryable, repoId: number): Promise<number> {
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM (
       SELECT s.user_id FROM submissions s
        JOIN repos r ON r.id = s.repo_id
        JOIN users u ON u.id = s.user_id
        WHERE s.repo_id = $1 AND s.status = 'active'
          AND u.account_state = 'active' AND u.anonymized_at IS NULL
          AND r.is_test_account = u.is_test_account
       UNION
       SELECT dp.user_id FROM devpost_participants dp
        JOIN repos r ON r.id = dp.repo_id
        JOIN users u ON u.id = dp.user_id
        WHERE dp.repo_id = $1 AND dp.user_id IS NOT NULL
          AND u.account_state = 'active' AND u.anonymized_at IS NULL
          AND r.is_test_account = u.is_test_account
     ) members`,
    [repoId],
  );
  return rows[0]?.n ?? 0;
}

export async function addRepoMember(actorId: number, repoId: number, userId: number) {
  return withTransaction(async (client) => {
    const user = await client.query(
      `SELECT id FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!user.rows[0]) throw new NotFoundError(`User ${userId} not found`);
    await assertFixtureSubjectScope(client, actorId, userId);
    await assertFixtureQueueScope(client, actorId, "repo", repoId);
    const repo = await client.query(`SELECT id FROM repos WHERE id = $1 FOR UPDATE`, [repoId]);
    if (!repo.rows[0]) throw new NotFoundError(`Repo ${repoId} not found`);

    const inserted = await client.query(
      `INSERT INTO submissions (repo_id, user_id, imported_from, external_id)
       VALUES ($1, $2, 'manual', NULL)
       ON CONFLICT (repo_id, user_id) DO NOTHING
       RETURNING repo_id, user_id`,
      [repoId, userId],
    );

    await audit(client, {
      actorId,
      entityType: "submission",
      entityId: `${repoId}:${userId}`,
      action: "add_member",
      after: { repoId, userId, inserted: (inserted.rowCount ?? 0) > 0 },
      source: "admin",
    });

    return { repoId, userId, inserted: (inserted.rowCount ?? 0) > 0 };
  });
}

export async function removeRepoMember(actorId: number, repoId: number, userId: number) {
  return withTransaction(async (client) => {
    const user = await client.query(
      `SELECT id FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!user.rows[0]) throw new NotFoundError(`User ${userId} not found`);
    await assertFixtureSubjectScope(client, actorId, userId);
    await assertFixtureQueueScope(client, actorId, "repo", repoId);
    const existing = await client.query(
      `SELECT * FROM submissions WHERE repo_id = $1 AND user_id = $2 FOR UPDATE`,
      [repoId, userId],
    );
    if (!existing.rows[0]) throw new NotFoundError(`Repo member ${repoId}:${userId} not found`);

    const importedIdentity = await client.query(
      `SELECT email FROM devpost_participants WHERE repo_id = $1 AND user_id = $2 LIMIT 1`,
      [repoId, userId],
    );
    if (importedIdentity.rows[0]) {
      throw new ConflictError(
        "Imported project members must be removed by their exact roster email",
        { repoId, userId, email: importedIdentity.rows[0].email },
      );
    }

    await client.query(`DELETE FROM submissions WHERE repo_id = $1 AND user_id = $2`, [
      repoId,
      userId,
    ]);

    await audit(client, {
      actorId,
      entityType: "submission",
      entityId: `${repoId}:${userId}`,
      action: "remove_member",
      before: { repoId, userId },
      after: {
        repoId,
        userId,
        detachedDevpostParticipants: [],
      },
      source: "admin",
    });
    return { repoId, userId, removed: true };
  });
}

export async function removeDevpostParticipant(actorId: number, repoId: number, email: string) {
  return withTransaction(async (client) => {
    await assertFixtureQueueScope(client, actorId, "repo", repoId);
    const linked = await client.query<{ user_id: number | null }>(
      `SELECT user_id FROM devpost_participants WHERE repo_id = $1 AND email = $2`,
      [repoId, email],
    );
    const linkedUserId = linked.rows[0]?.user_id;
    if (linkedUserId != null) {
      const user = await client.query(
        `SELECT id FROM users
          WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
          FOR UPDATE`,
        [linkedUserId],
      );
      if (!user.rows[0]) throw new NotFoundError(`User ${linkedUserId} not found`);
      await assertFixtureSubjectScope(client, actorId, linkedUserId);
    }
    const existing = await client.query(
      `SELECT * FROM devpost_participants WHERE repo_id = $1 AND email = $2 FOR UPDATE`,
      [repoId, email],
    );
    const participant = existing.rows[0] as
      | { repo_id: number; email: string; user_id: number | null; merge_status: string }
      | undefined;
    if (!participant) {
      throw new NotFoundError(`No devpost participant ${email} for repo ${repoId}`);
    }

    if (participant.user_id !== null) {
      await client.query(
        `DELETE FROM submissions
          WHERE repo_id = $1 AND user_id = $2 AND imported_from = 'devpost'
          AND NOT EXISTS (
            SELECT 1 FROM devpost_participants
             WHERE repo_id = $1 AND user_id = $2 AND email <> $3
          )`,
        [repoId, participant.user_id, email],
      );
    }
    await client.query(`DELETE FROM devpost_participants WHERE repo_id = $1 AND email = $2`, [
      repoId,
      email,
    ]);
    await audit(client, {
      actorId,
      entityType: "devpost_participant",
      entityId: `${repoId}:${email}`,
      action: "delete",
      before: {
        repoId,
        email,
        userId: participant.user_id,
        mergeStatus: participant.merge_status,
      },
      source: "admin",
    });
    return { repoId, email, removed: true };
  });
}

export async function removeRepoPrize(actorId: number, repoId: number, prizeName: string) {
  return withTransaction(async (client) => {
    await assertFixtureQueueScope(client, actorId, "repo", repoId);
    const existing = await client.query(
      `SELECT * FROM repo_devpost_prizes WHERE repo_id = $1 AND prize = $2 FOR UPDATE`,
      [repoId, prizeName],
    );
    if (!existing.rows[0])
      throw new NotFoundError(`Repo ${repoId} is not linked to prize ${prizeName}`);

    await client.query(`DELETE FROM repo_devpost_prizes WHERE repo_id = $1 AND prize = $2`, [
      repoId,
      prizeName,
    ]);
    await audit(client, {
      actorId,
      entityType: "repo_devpost_prize",
      entityId: `${repoId}:${prizeName}`,
      action: "remove_prize",
      before: { repoId, prize: prizeName },
      source: "admin",
    });
    return { repoId, prize: prizeName, removed: true };
  });
}

interface EnqueueOutcome {
  entry: Record<string, unknown> & { id: number; challenge_id: number };
  inserted: boolean;
  revived: boolean;
}

/**
 * Core of H21's "apuntar un equipo a un reto": appends the repo at the
 * BOTTOM of the challenge's queue, reviving a terminal (cancelled /
 * disqualified / completed) entry instead of duplicating it. Writes exactly
 * one queue_history row + one audit row per mutation (plan/07 invariant 5).
 * Returns null when the repo is already actively queued (no-op). The caller
 * owns the transaction and must broadcast QUEUE_ENTRY_CHANGED + notify the
 * challenge AFTER commit for every non-null outcome.
 */
async function enqueueRepoOnChallenge(
  client: Queryable,
  actorId: number,
  repoId: number,
  challengeId: number,
  auditSource: string,
): Promise<EnqueueOutcome | null> {
  const repoMarker = await assertQueueRepoScope(client, actorId, repoId);
  const challengeMarker = await assertQueueChallengeScope(client, actorId, challengeId);
  if (repoMarker !== challengeMarker) {
    throw new ConflictError("Queue fixture markers must match", {
      code: "review_fixture_scope",
      repoId,
      challengeId,
    });
  }
  const existing = await client.query(
    `SELECT * FROM queue_entries WHERE repo_id = $1 AND challenge_id = $2 FOR UPDATE`,
    [repoId, challengeId],
  );
  if (existing.rows[0]) {
    const entry = existing.rows[0] as { id: number; status: string };
    if (!["cancelled", "disqualified", "completed"].includes(entry.status)) return null;
    const position = await nextBottomPosition(client, challengeId);
    const revived = await client.query(
      `UPDATE queue_entries
          SET status = 'waiting', position = $1, assigned_room_id = NULL,
              called_at = NULL, precalled_at = NULL, presentation_started_at = NULL,
              completed_at = NULL
        WHERE id = $2
        RETURNING *`,
      [position, entry.id],
    );
    await writeQueueHistory(client, {
      entryId: entry.id,
      actorId,
      previousStatus: entry.status,
      newStatus: "waiting",
      action: "re_enter",
      reason: "Added back to challenge",
      metadata: { position: "bottom" },
    });
    await audit(client, {
      actorId,
      entityType: "queue_entry",
      entityId: entry.id,
      action: "re_enter",
      before: { status: entry.status },
      after: { status: "waiting", position: "bottom" },
      reason: "Added back to challenge",
      source: auditSource,
    });
    return { entry: revived.rows[0], inserted: false, revived: true };
  }

  const position = await nextBottomPosition(client, challengeId);
  const inserted = await client.query(
    `INSERT INTO queue_entries (challenge_id, repo_id, status, position)
     VALUES ($1, $2, 'waiting', $3)
     RETURNING *`,
    [challengeId, repoId, position],
  );
  const entry = inserted.rows[0];
  await client.query(
    `INSERT INTO queue_history
       (queue_entry_id, actor_id, previous_status, new_status, action, metadata)
     VALUES ($1, $2, 'none', 'waiting', 'enqueue', $3)`,
    [entry.id, actorId, JSON.stringify({ source: "project_edit" })],
  );
  await audit(client, {
    actorId,
    entityType: "queue_entry",
    entityId: entry.id,
    action: "add_challenge",
    after: { repoId, challengeId, status: "waiting", position },
    source: auditSource,
  });
  return { entry, inserted: true, revived: false };
}

export async function addRepoChallenge(actorId: number, repoId: number, challengeId: number) {
  const result = await withTransaction(async (client) => {
    const repoMarker = await assertQueueRepoScope(client, actorId, repoId);
    const challengeMarker = await assertQueueChallengeScope(client, actorId, challengeId);
    if (repoMarker !== challengeMarker) {
      throw new ConflictError("Queue fixture markers must match", {
        code: "review_fixture_scope",
        repoId,
        challengeId,
      });
    }
    const repo = await client.query(`SELECT id FROM repos WHERE id = $1 FOR UPDATE`, [repoId]);
    if (!repo.rows[0]) throw new NotFoundError(`Repo ${repoId} not found`);
    const challenge = await client.query(`SELECT id FROM challenges WHERE id = $1`, [challengeId]);
    if (!challenge.rows[0]) throw new NotFoundError(`Challenge ${challengeId} not found`);

    const outcome = await enqueueRepoOnChallenge(client, actorId, repoId, challengeId, "admin");
    if (!outcome) return { repoId, challengeId, entry: null, inserted: false, revived: false };
    return { repoId, challengeId, ...outcome };
  });
  if (result.entry) {
    await broadcastQueueEvent(
      pool,
      "entry",
      result.entry.id,
      EVENTS.QUEUE_ENTRY_CHANGED,
      result.entry,
    );
    await notifyChallengeQueueChanged(pool, result.entry.challenge_id);
  }
  return result;
}

/**
 * Transitions one queue entry out of a challenge (waiting/called -> cancelled,
 * anything further along -> disqualified), writing the matching history row
 * and audit entry. Shared by the single and bulk removal paths.
 */
async function terminateQueueEntry(
  client: Queryable,
  entry: { id: number; repo_id: number; status: string },
  actorId: number,
  options: { challengeId: number; reason: string },
): Promise<Record<string, unknown>> {
  const nextStatus = ["waiting", "called"].includes(entry.status) ? "cancelled" : "disqualified";
  const updated = await client.query(
    `UPDATE queue_entries
        SET status = $1, assigned_room_id = NULL, position = NULL, called_at = NULL,
            precalled_at = NULL, presentation_started_at = NULL, completed_at = NULL
      WHERE id = $2
      RETURNING *`,
    [nextStatus, entry.id],
  );
  await writeQueueHistory(client, {
    entryId: entry.id,
    actorId,
    previousStatus: entry.status,
    newStatus: nextStatus,
    action: "remove_from_challenge",
    reason: options.reason,
  });
  await audit(client, {
    actorId,
    entityType: "queue_entry",
    entityId: entry.id,
    action: "remove_from_challenge",
    before: { status: entry.status, challengeId: options.challengeId, repoId: entry.repo_id },
    after: { status: nextStatus },
    reason: options.reason,
    source: "admin",
  });
  return updated.rows[0];
}

export async function removeRepoChallenge(actorId: number, repoId: number, challengeId: number) {
  const result = await withTransaction(async (client) => {
    const repoMarker = await assertQueueRepoScope(client, actorId, repoId);
    const challengeMarker = await assertQueueChallengeScope(client, actorId, challengeId);
    if (repoMarker !== challengeMarker) {
      throw new ConflictError("Queue fixture markers must match", {
        code: "review_fixture_scope",
        repoId,
        challengeId,
      });
    }
    const entryRes = await client.query(
      `SELECT * FROM queue_entries WHERE repo_id = $1 AND challenge_id = $2 FOR UPDATE`,
      [repoId, challengeId],
    );
    const entry = entryRes.rows[0];
    if (!entry)
      throw new NotFoundError(`Repo ${repoId} is not assigned to challenge ${challengeId}`);

    const updatedEntry = await terminateQueueEntry(client, entry, actorId, {
      challengeId,
      reason: "Removed from challenge",
    });
    await compactQueueGroupPositions(client, challengeId);
    return { repoId, challengeId, entry: updatedEntry, removed: true };
  });
  await broadcastQueueEvent(
    pool,
    "entry",
    Number(result.entry.id),
    EVENTS.QUEUE_ENTRY_CHANGED,
    result.entry,
  );
  await notifyChallengeQueueChanged(pool, result.challengeId);
  return result;
}

export interface BulkAddResult {
  total: number;
  added: number;
  alreadyEnrolled: number;
}

export interface BulkRemoveResult {
  total: number;
  removed: number;
  alreadySkipped: number;
}

/**
 * H21 "apuntar TODOS los proyectos a un reto" — enrolls every existing repo
 * into `challengeId` in one transaction, reusing the same per-repo enqueue
 * logic as the single add (`enqueueRepoOnChallenge`), so idempotency (the
 * unique challenge_id/repo_id index) and the revive-vs-insert behavior are
 * identical to the single-repo path. Repos already actively queued are
 * skipped, not duplicated.
 */
export async function bulkAddRepoChallenge(
  actorId: number,
  challengeId: number,
): Promise<BulkAddResult> {
  const { outcomes, total } = await withTransaction(async (client) => {
    await assertQueueChallengeScope(client, actorId, challengeId);
    const challenge = await client.query(`SELECT id FROM challenges WHERE id = $1`, [challengeId]);
    if (!challenge.rows[0]) throw new NotFoundError(`Challenge ${challengeId} not found`);

    const repos = await client.query(
      `SELECT id FROM repos WHERE is_test_account = $1 ORDER BY id`,
      [await isSyntheticOperator(client, actorId)],
    );
    const repoIds = repos.rows.map((r: { id: number }) => r.id);

    const outcomes: EnqueueOutcome[] = [];
    for (const repoId of repoIds) {
      const outcome = await enqueueRepoOnChallenge(client, actorId, repoId, challengeId, "admin");
      if (outcome) outcomes.push(outcome);
    }

    await audit(client, {
      actorId,
      entityType: "challenge",
      entityId: challengeId,
      action: "bulk_add_repos",
      after: { total: repoIds.length, added: outcomes.length },
      source: "admin",
    });

    return { outcomes, total: repoIds.length };
  });

  await announceQueueOutcomes(outcomes);
  return { total, added: outcomes.length, alreadyEnrolled: total - outcomes.length };
}

/**
 * H21 "dar de baja TODOS los proyectos de un reto" — mirrors
 * `removeRepoChallenge`'s per-entry transition (waiting/called -> cancelled,
 * anything else in progress -> disqualified, same as a live correction is
 * allowed to force) but applies it to every active entry of the challenge in
 * one transaction, with a single position compaction at the end instead of
 * one per entry.
 */
export async function bulkRemoveRepoChallenge(
  actorId: number,
  challengeId: number,
): Promise<BulkRemoveResult> {
  const { updatedEntries, total } = await withTransaction(async (client) => {
    await assertQueueChallengeScope(client, actorId, challengeId);
    const challenge = await client.query(`SELECT id FROM challenges WHERE id = $1`, [challengeId]);
    if (!challenge.rows[0]) throw new NotFoundError(`Challenge ${challengeId} not found`);

    const entriesRes = await client.query(
      `SELECT * FROM queue_entries WHERE challenge_id = $1 FOR UPDATE`,
      [challengeId],
    );
    const entries = entriesRes.rows as Array<{ id: number; repo_id: number; status: string }>;
    const removable = entries.filter((e) => !["cancelled", "disqualified"].includes(e.status));

    const updatedEntries: Array<Record<string, unknown> & { challenge_id: number }> = [];
    for (const entry of removable) {
      const updatedEntry = await terminateQueueEntry(client, entry, actorId, {
        challengeId,
        reason: "Removed from challenge (bulk)",
      });
      updatedEntries.push(updatedEntry as Record<string, unknown> & { challenge_id: number });
    }
    if (removable.length > 0) await compactQueueGroupPositions(client, challengeId);

    await audit(client, {
      actorId,
      entityType: "challenge",
      entityId: challengeId,
      action: "bulk_remove_repos",
      after: { total: entries.length, removed: removable.length },
      source: "admin",
    });

    return { updatedEntries, total: entries.length };
  });

  for (const entry of updatedEntries) {
    await broadcastQueueEvent(pool, "entry", Number(entry.id), EVENTS.QUEUE_ENTRY_CHANGED, entry);
  }
  if (updatedEntries.length > 0) await notifyChallengeQueueChanged(pool, challengeId);

  return { total, removed: updatedEntries.length, alreadySkipped: total - updatedEntries.length };
}

// ── native project lifecycle (H18-H19) ─────────────────────────────────────

export interface NativeRepoInput {
  name: string;
  description: string;
  githubUrl: string | null;
  demoUrl: string | null;
  challengeIds: number[];
}

interface EnqueuedChallenge {
  challengeId: number;
  entryId: number;
  position: number | null;
}

function toEnqueuedChallenge(outcome: EnqueueOutcome): EnqueuedChallenge {
  return {
    challengeId: outcome.entry.challenge_id,
    entryId: outcome.entry.id,
    position: (outcome.entry.position as number | null) ?? null,
  };
}

/** Enqueued entries a caller must announce (SSE + notify) after commit. */
async function announceQueueOutcomes(outcomes: EnqueueOutcome[]): Promise<void> {
  for (const outcome of outcomes) {
    await broadcastQueueEvent(
      pool,
      "entry",
      outcome.entry.id,
      EVENTS.QUEUE_ENTRY_CHANGED,
      outcome.entry,
    );
    await notifyChallengeQueueChanged(pool, outcome.entry.challenge_id);
  }
}

/**
 * `visibleOnly` is the participant path (H19): they can only pick challenges
 * the public site shows, and an unpublished id reads as "not found" so its
 * existence never leaks.
 */
async function assertChallengesExist(
  client: Queryable,
  challengeIds: number[],
  visibleOnly = false,
  fixtureMarker = false,
): Promise<void> {
  if (challengeIds.length === 0) return;
  const { rows } = await client.query(
    `SELECT id FROM challenges WHERE id = ANY($1::int[]) AND is_test_account = $2
      ${visibleOnly ? `AND visibility = 'visible'` : ""}`,
    [challengeIds, fixtureMarker],
  );
  const found = new Set(rows.map((r: { id: number }) => r.id));
  const missing = challengeIds.filter((id) => !found.has(id));
  if (missing.length > 0) throw new NotFoundError(`Challenge ${missing.join(", ")} not found`);
}

async function insertNativeRepo(
  client: Queryable,
  input: NativeRepoInput,
  createdBy: number,
  fixtureMarker = false,
): Promise<RepoRow> {
  const { rows } = await client.query(
    `INSERT INTO repos (name, description, github_url, demo_url, source, created_by, is_test_account)
     VALUES ($1, $2, $3, $4, 'native', $5, $6)
     RETURNING id, name, description, github_url, devpost_url, demo_url, source`,
    [input.name, input.description, input.githubUrl, input.demoUrl, createdBy, fixtureMarker],
  );
  return rows[0];
}

/**
 * H18: organization creates a project natively (no Devpost involved), with
 * team members and challenge lineup in ONE transaction — challenges are
 * appended at the bottom of any already-generated queues exactly like a hot
 * edit (H21), so an event can run entirely without imports.
 */
export async function createRepoNative(
  actorId: number,
  input: NativeRepoInput & { memberUserIds: number[] },
): Promise<{ repo: RepoRow; memberUserIds: number[]; challenges: EnqueuedChallenge[] }> {
  const memberUserIds = [...new Set(input.memberUserIds)];
  const challengeIds = [...new Set(input.challengeIds)];
  const { repo, outcomes } = await withTransaction(async (client) => {
    const fixtureMarker = await isSyntheticOperator(client, actorId);
    if (memberUserIds.length > 0) {
      const { rows } = await client.query(
        `SELECT id, is_test_account FROM users
          WHERE id = ANY($1::int[])
            AND account_state = 'active' AND anonymized_at IS NULL
          ORDER BY id
          FOR UPDATE`,
        [memberUserIds],
      );
      const found = new Set(rows.map((r: { id: number }) => r.id));
      const missing = memberUserIds.filter((id) => !found.has(id));
      if (missing.length > 0) throw new NotFoundError(`User ${missing.join(", ")} not found`);
      for (const userId of memberUserIds) {
        await assertFixtureSubjectScope(client, actorId, userId);
      }
    }
    await assertChallengesExist(client, challengeIds, false, fixtureMarker);

    const created = await insertNativeRepo(client, input, actorId, fixtureMarker);
    for (const userId of memberUserIds) {
      await client.query(
        `INSERT INTO submissions (repo_id, user_id, imported_from, external_id)
         VALUES ($1, $2, 'manual', NULL)`,
        [created.id, userId],
      );
    }
    const enqueued: EnqueueOutcome[] = [];
    for (const challengeId of challengeIds) {
      const outcome = await enqueueRepoOnChallenge(
        client,
        actorId,
        created.id,
        challengeId,
        "admin",
      );
      if (outcome) enqueued.push(outcome);
    }
    await audit(client, {
      actorId,
      entityType: "repo",
      entityId: created.id,
      action: "create",
      after: { name: created.name, source: "native", memberUserIds, challengeIds },
      source: "admin",
    });
    return { repo: created, outcomes: enqueued };
  });
  await announceQueueOutcomes(outcomes);
  return {
    repo,
    memberUserIds,
    challenges: outcomes.map(toEnqueuedChallenge),
  };
}

export interface UpdateRepoPatch {
  name?: string;
  description?: string;
  githubUrl?: string | null;
  demoUrl?: string | null;
}

/**
 * Shared metadata-update core for both the staff PATCH (`updateRepo`, H18)
 * and the participant self-edit (`updateMyProject`, H19/H20) — same fields,
 * different callers audit it with their own actor/source. Locks the row
 * first so a concurrent edit can't interleave with the read-modify-write.
 */
async function applyRepoUpdate(
  client: Queryable,
  repoId: number,
  patch: UpdateRepoPatch,
): Promise<{ before: RepoRow; after: RepoRow }> {
  const existing = await client.query(`${REPO_SELECT} WHERE id = $1 FOR UPDATE`, [repoId]);
  const before = existing.rows[0] as RepoRow | undefined;
  if (!before) throw new NotFoundError(`Repo ${repoId} not found`);

  const next = {
    name: patch.name ?? before.name,
    description: patch.description ?? before.description,
    github_url: patch.githubUrl === undefined ? before.github_url : patch.githubUrl,
    demo_url: patch.demoUrl === undefined ? before.demo_url : patch.demoUrl,
  };
  const { rows } = await client.query(
    `UPDATE repos SET name = $2, description = $3, github_url = $4, demo_url = $5
      WHERE id = $1
      RETURNING id, name, description, github_url, devpost_url, demo_url, source`,
    [repoId, next.name, next.description, next.github_url, next.demo_url],
  );
  return { before, after: rows[0] as RepoRow };
}

function repoAuditFields(repo: RepoRow) {
  return {
    name: repo.name,
    description: repo.description,
    githubUrl: repo.github_url,
    demoUrl: repo.demo_url,
  };
}

/** H18: edit a project's own metadata (title, description, links). Audited. */
export async function updateRepo(actorId: number, repoId: number, patch: UpdateRepoPatch) {
  return withTransaction(async (client) => {
    await assertFixtureQueueScope(client, actorId, "repo", repoId);
    const { before, after } = await applyRepoUpdate(client, repoId, patch);
    await audit(client, {
      actorId,
      entityType: "repo",
      entityId: repoId,
      action: "update",
      before: repoAuditFields(before),
      after: repoAuditFields(after),
      source: "admin",
    });
    return after;
  });
}

/**
 * H19/H20: a participant edits their own project's metadata — only while
 * within the hacking window and only for a project they're an active member
 * of. Product decision superseding H20's literal "read-only" text (see
 * docs/challenges-devpost.md); plan/historias-hackos.md is left unedited.
 */
export async function updateMyProject(
  userId: number,
  repoId: number,
  patch: UpdateRepoPatch,
): Promise<RepoRow> {
  return withTransaction(async (client) => {
    const { rows: userRows } = await client.query(
      `SELECT id FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!userRows[0]) throw new NotFoundError("User not found");
    await assertFixtureSubjectScope(client, userId, userId);
    await assertFixtureQueueScope(client, userId, "repo", repoId);
    await assertWithinHackingWindow(client);
    if (!(await isActiveProjectMember(client, repoId, userId))) {
      throw new ForbiddenError("Not a member of this project");
    }
    const { before, after } = await applyRepoUpdate(client, repoId, patch);
    await audit(client, {
      actorId: userId,
      entityType: "repo",
      entityId: repoId,
      action: "update",
      before: repoAuditFields(before),
      after: repoAuditFields(after),
      source: "participant",
    });
    return after;
  });
}

/** True when the event's H19 policy switch allows participant self-creation. */
export async function participantsCanCreateProjects(): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT participants_can_create_projects FROM event_config WHERE id = 1`,
  );
  return rows[0]?.participants_can_create_projects === true;
}

/**
 * H19/H20: whether userId may self-create a project right now — the event
 * policy is on, they're an admitted participant, and the hacking window is
 * open. No longer also requires "doesn't already belong to a project": since
 * self-service allows multiple memberships, GET /api/me/projects.canCreate
 * must reflect exactly the same gate createMyProject enforces, not a
 * leftover "one project only" restriction.
 */
export async function canCreateMyProject(userId: number): Promise<boolean> {
  if (!(await participantsCanCreateProjects())) return false;
  if (!(await isAdmittedParticipant(pool, userId))) return false;
  return isWithinHackingWindow(pool);
}

/**
 * H19: a participant creates THEIR OWN project — only while the event policy
 * (event_config.participants_can_create_projects) is enabled. Product
 * decision (see docs/challenges-devpost.md) now also allows a participant to
 * belong to more than one project — H20's original "singular mi proyecto"
 * framing assumed the read-only surface; self-service supersedes it, so
 * there is no longer a "you already belong to a project" check here.
 * Self-creation is further gated to admitted participants (same check as
 * mobile access) and to the configured hacking window. The creator becomes
 * the project's first member; chosen challenges enqueue exactly like a hot
 * edit.
 */
export async function createMyProject(
  userId: number,
  input: NativeRepoInput,
): Promise<{ repo: RepoRow; challenges: EnqueuedChallenge[] }> {
  const challengeIds = [...new Set(input.challengeIds)];
  const { repo, outcomes } = await withTransaction(async (client) => {
    const user = await client.query<{ is_test_account: boolean }>(
      `SELECT is_test_account FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!user.rows[0]) throw new NotFoundError("User not found");
    const fixtureMarker = user.rows[0].is_test_account === true;
    // Serialized per-user — harmless now that multiple projects are allowed,
    // kept for symmetry with the rest of this transaction's row locks.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('my_project_create'), $1)`, [userId]);

    const policy = await client.query(
      `SELECT participants_can_create_projects FROM event_config WHERE id = 1`,
    );
    if (policy.rows[0]?.participants_can_create_projects !== true) {
      throw new ForbiddenError("Participant project creation is disabled for this event");
    }

    if (!(await isAdmittedParticipant(client, userId))) {
      throw new ForbiddenError("Only admitted participants can create a project");
    }
    await assertWithinHackingWindow(client);

    await assertChallengesExist(client, challengeIds, true, fixtureMarker);

    const created = await insertNativeRepo(client, input, userId, fixtureMarker);
    await client.query(
      `INSERT INTO submissions (repo_id, user_id, imported_from, external_id)
       VALUES ($1, $2, 'manual', NULL)`,
      [created.id, userId],
    );
    const enqueued: EnqueueOutcome[] = [];
    for (const challengeId of challengeIds) {
      const outcome = await enqueueRepoOnChallenge(client, userId, created.id, challengeId, "web");
      if (outcome) enqueued.push(outcome);
    }
    await audit(client, {
      actorId: userId,
      entityType: "repo",
      entityId: created.id,
      action: "create",
      after: { name: created.name, source: "native", createdBy: userId, challengeIds },
      source: "web",
    });
    return { repo: created, outcomes: enqueued };
  });
  await announceQueueOutcomes(outcomes);
  return {
    repo,
    challenges: outcomes.map(toEnqueuedChallenge),
  };
}

// ── H19/H20 self-service membership: invite, accept/decline, leave, delete ──

function displayName(row: {
  name?: string | null;
  surname?: string | null;
  email: string;
}): string {
  const full = [row.name, row.surname].filter(Boolean).join(" ").trim();
  return full || row.email;
}

/**
 * H19/H20: an active member invites a teammate by email. The invitee must be
 * an account holder AND an admitted participant, and must not already be an
 * active member of this exact project. The invite is a pending `submissions`
 * row (status='invited') until the invitee accepts or declines it.
 */
export async function inviteProjectMember(
  userId: number,
  repoId: number,
  email: string,
): Promise<{ invited: true }> {
  return withTransaction(async (client) => {
    const inviterUser = await client.query(
      `SELECT id FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!inviterUser.rows[0]) throw new NotFoundError("User not found");
    await assertFixtureSubjectScope(client, userId, userId);
    await assertFixtureQueueScope(client, userId, "repo", repoId);
    await assertWithinHackingWindow(client);
    if (!(await isActiveProjectMember(client, repoId, userId))) {
      throw new ForbiddenError("Not a member of this project");
    }

    const repoRes = await client.query(`SELECT id, name FROM repos WHERE id = $1`, [repoId]);
    const repo = repoRes.rows[0] as { id: number; name: string } | undefined;
    if (!repo) throw new NotFoundError(`Repo ${repoId} not found`);

    const inviteeRes = await client.query(
      `SELECT id FROM users
        WHERE lower(email) = lower($1)
          AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [email],
    );
    const inviteeId = inviteeRes.rows[0]?.id as number | undefined;
    if (!inviteeId) throw new NotFoundError(`No account for ${email}`);
    await assertFixtureSubjectScope(client, userId, inviteeId);

    if (!(await isAdmittedParticipant(client, inviteeId))) {
      throw new ForbiddenError(`${email} is not an admitted participant`);
    }
    if (await isActiveProjectMember(client, repoId, inviteeId)) {
      throw new ConflictError(`${email} is already a member of this project`);
    }

    // A prior still-pending invite to the same person is idempotent success,
    // not an error — ON CONFLICT DO NOTHING covers the (repo_id, user_id)
    // primary key without a duplicate row or a spurious 409.
    await client.query(
      `INSERT INTO submissions (repo_id, user_id, imported_from, status, invited_by)
       VALUES ($1, $2, 'manual', 'invited', $3)
       ON CONFLICT (repo_id, user_id) DO NOTHING
       RETURNING repo_id`,
      [repoId, inviteeId, userId],
    );

    await audit(client, {
      actorId: userId,
      entityType: "repo",
      entityId: repoId,
      action: "member.invite",
      after: { invitedUserId: inviteeId, email },
      source: "participant",
    });

    const inviterRes = await client.query(
      `SELECT name, surname, email FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL`,
      [userId],
    );
    const inviter = inviterRes.rows[0] as
      | { name: string | null; surname: string | null; email: string }
      | undefined;
    await notify(client, {
      userId: inviteeId,
      category: "project",
      actorId: userId,
      payload: {
        template: "project.invite",
        vars: { projectName: repo.name, inviterName: inviter ? displayName(inviter) : "" },
      },
    });

    return { invited: true };
  });
}

export interface PendingInvite {
  repoId: number;
  repoName: string;
  invitedByName: string | null;
  invitedAt: Date;
}

/** H19/H20: pending invites addressed to userId, newest first. */
export async function myPendingInvites(userId: number): Promise<PendingInvite[]> {
  const { rows: userRows } = await pool.query<{ is_test_account: boolean }>(
    `SELECT is_test_account FROM users WHERE id = $1`,
    [userId],
  );
  const fixtureMarker = userRows[0]?.is_test_account === true;
  const { rows } = await pool.query(
    `SELECT s.repo_id, r.name AS repo_name, u.name AS inviter_name, u.surname AS inviter_surname,
            u.email AS inviter_email, s.created_at AS invited_at
       FROM submissions s
       JOIN repos r ON r.id = s.repo_id AND r.is_test_account = $2
       LEFT JOIN users u ON u.id = s.invited_by
          AND u.account_state = 'active' AND u.anonymized_at IS NULL
      WHERE s.user_id = $1 AND s.status = 'invited'
      ORDER BY s.created_at DESC`,
    [userId, fixtureMarker],
  );
  return (
    rows as Array<{
      repo_id: number;
      repo_name: string;
      inviter_name: string | null;
      inviter_surname: string | null;
      inviter_email: string | null;
      invited_at: Date;
    }>
  ).map((row) => ({
    repoId: row.repo_id,
    repoName: row.repo_name,
    invitedByName: row.inviter_email
      ? displayName({
          name: row.inviter_name,
          surname: row.inviter_surname,
          email: row.inviter_email,
        })
      : null,
    invitedAt: row.invited_at,
  }));
}

/** H19/H20: the invited user accepts, becoming an active member. */
export async function acceptProjectInvite(
  userId: number,
  repoId: number,
): Promise<{ accepted: true }> {
  return withTransaction(async (client) => {
    const user = await client.query(
      `SELECT id FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!user.rows[0]) throw new NotFoundError("User not found");
    await assertFixtureSubjectScope(client, userId, userId);
    await assertFixtureQueueScope(client, userId, "repo", repoId);
    await assertWithinHackingWindow(client);
    const { rows } = await client.query(
      `UPDATE submissions SET status = 'active', responded_at = now()
        WHERE repo_id = $1 AND user_id = $2 AND status = 'invited'
        RETURNING repo_id`,
      [repoId, userId],
    );
    if (!rows[0]) throw new NotFoundError(`No pending invite to repo ${repoId}`);
    await audit(client, {
      actorId: userId,
      entityType: "repo",
      entityId: repoId,
      action: "member.invite_accept",
      after: { userId },
      source: "participant",
    });
    return { accepted: true };
  });
}

/** H19/H20: the invited user declines; the pending row is removed entirely. */
export async function declineProjectInvite(
  userId: number,
  repoId: number,
): Promise<{ declined: true }> {
  return withTransaction(async (client) => {
    const user = await client.query(
      `SELECT id FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!user.rows[0]) throw new NotFoundError("User not found");
    await assertFixtureSubjectScope(client, userId, userId);
    await assertFixtureQueueScope(client, userId, "repo", repoId);
    await assertWithinHackingWindow(client);
    const { rows } = await client.query(
      `DELETE FROM submissions WHERE repo_id = $1 AND user_id = $2 AND status = 'invited'
       RETURNING repo_id`,
      [repoId, userId],
    );
    if (!rows[0]) throw new NotFoundError(`No pending invite to repo ${repoId}`);
    await audit(client, {
      actorId: userId,
      entityType: "repo",
      entityId: repoId,
      action: "member.invite_decline",
      before: { userId },
      source: "participant",
    });
    return { declined: true };
  });
}

/**
 * H19/H20: an active member leaves their own project. The last member can't
 * leave (they must delete the project instead) — that keeps a project from
 * silently becoming memberless while still enqueued for judging.
 */
export async function leaveMyProject(userId: number, repoId: number): Promise<{ left: true }> {
  return withTransaction(async (client) => {
    const user = await client.query(
      `SELECT id FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!user.rows[0]) throw new NotFoundError("User not found");
    await assertFixtureSubjectScope(client, userId, userId);
    await assertFixtureQueueScope(client, userId, "repo", repoId);
    await assertWithinHackingWindow(client);
    if (!(await isActiveProjectMember(client, repoId, userId))) {
      throw new ForbiddenError("Not a member of this project");
    }
    const count = await activeProjectMemberCount(client, repoId);
    if (count <= 1) {
      throw new ConflictError("You are the last member; delete the project instead");
    }

    const removed = await client.query(
      `DELETE FROM submissions WHERE repo_id = $1 AND user_id = $2 AND status = 'active'`,
      [repoId, userId],
    );
    if ((removed.rowCount ?? 0) === 0) {
      await client.query(`DELETE FROM devpost_participants WHERE repo_id = $1 AND user_id = $2`, [
        repoId,
        userId,
      ]);
    }

    await audit(client, {
      actorId: userId,
      entityType: "repo",
      entityId: repoId,
      action: "member.leave",
      before: { userId },
      source: "participant",
    });
    return { left: true };
  });
}

interface DeletedQueueEntry {
  id: number;
  challenge_id: number;
  repo_id: number;
  fixtureMarker: boolean | null;
}

/**
 * Deletes every row that transitively references repoId before the repo row
 * itself — none of the FKs onto `repos`/`queue_entries` cascade, and
 * `deleteMyProject` only ever reaches here once the caller has confirmed
 * they're the project's sole member.
 *
 * H19/H20 + H38/H41: queue entries and their active repo members disappear in
 * this transaction, so ids, marker-scoped broadcast topics, and personal
 * invalidation recipients must be captured before the delete. The caller emits
 * those notifications only after this transaction commits; the delayed worker
 * cannot rediscover a member from queue rows that no longer exist.
 */
async function deleteRepoCascade(
  client: Queryable,
  repoId: number,
  fixtureMarker: boolean,
): Promise<{ queueEntries: DeletedQueueEntry[]; memberIds: number[] }> {
  const memberIds = await repoMemberIds(client, repoId, fixtureMarker);
  const queueEntriesRes = await client.query<{
    id: number;
    challenge_id: number;
    repo_id: number;
    challenge_is_test_account: boolean;
    repo_is_test_account: boolean;
  }>(
    `SELECT qe.id, qe.challenge_id, qe.repo_id,
            c.is_test_account AS challenge_is_test_account,
            r.is_test_account AS repo_is_test_account
       FROM queue_entries qe
       JOIN challenges c ON c.id = qe.challenge_id
       JOIN repos r ON r.id = qe.repo_id
      WHERE qe.repo_id = $1
      ORDER BY qe.id
      FOR UPDATE OF qe`,
    [repoId],
  );
  const queueEntries = queueEntriesRes.rows.map((entry) => ({
    id: Number(entry.id),
    challenge_id: Number(entry.challenge_id),
    repo_id: Number(entry.repo_id),
    // A mixed queue graph is an isolation violation; fail closed instead of
    // putting a deleted fixture payload on the real operator stream (H54).
    fixtureMarker:
      entry.challenge_is_test_account === entry.repo_is_test_account
        ? entry.challenge_is_test_account === true
        : null,
  }));

  // The caller checked the repository graph before locking it, but a stale
  // or direct-SQL queue row can still be introduced before this transaction
  // acquires the entry locks. Re-resolve every locked entry's complete group
  // and room graph before any destructive delete so self-service cannot turn
  // a raced mixed fixture into a real-topic invalidation (H19/H20, H54).
  for (const entry of queueEntries) {
    let resolvedMarker: boolean | null;
    try {
      resolvedMarker = await queueFixtureMarker(client, "entry", entry.id);
    } catch {
      resolvedMarker = null;
    }
    if (resolvedMarker === null || resolvedMarker !== fixtureMarker) {
      throw new ConflictError("Queue fixture markers must match", {
        code: "review_fixture_scope",
        resource: "repo",
        resourceId: repoId,
      });
    }
    entry.fixtureMarker = resolvedMarker;
  }

  await client.query(
    `DELETE FROM attempt_review_versions WHERE attempt_id IN
       (SELECT id FROM queue_entries WHERE repo_id = $1)`,
    [repoId],
  );
  await client.query(
    `DELETE FROM attempt_review WHERE attempt_id IN
       (SELECT id FROM queue_entries WHERE repo_id = $1)`,
    [repoId],
  );
  await client.query(
    `DELETE FROM judging_session WHERE queue_entry_id IN
       (SELECT id FROM queue_entries WHERE repo_id = $1)`,
    [repoId],
  );
  await client.query(
    `DELETE FROM queue_history WHERE queue_entry_id IN
       (SELECT id FROM queue_entries WHERE repo_id = $1)`,
    [repoId],
  );
  await client.query(`DELETE FROM challenge_winners WHERE repo_id = $1`, [repoId]);
  await client.query(`DELETE FROM queue_entries WHERE repo_id = $1`, [repoId]);
  await client.query(`DELETE FROM submissions WHERE repo_id = $1`, [repoId]);
  await client.query(`DELETE FROM devpost_participants WHERE repo_id = $1`, [repoId]);
  await client.query(`DELETE FROM repo_devpost_prizes WHERE repo_id = $1`, [repoId]);
  await client.query(`DELETE FROM repos WHERE id = $1`, [repoId]);
  return { queueEntries, memberIds };
}

/**
 * H19/H20: the last remaining member deletes their own project outright.
 * Re-checks the caller is both a member and the SOLE member inside the
 * transaction before touching anything irreversible.
 */
export async function deleteMyProject(userId: number, repoId: number): Promise<{ deleted: true }> {
  const { queueEntries, memberIds } = await withTransaction(async (client) => {
    const user = await client.query(
      `SELECT id FROM users
        WHERE id = $1 AND account_state = 'active' AND anonymized_at IS NULL
        FOR UPDATE`,
      [userId],
    );
    if (!user.rows[0]) throw new NotFoundError("User not found");
    await assertFixtureSubjectScope(client, userId, userId);
    await assertQueueRepoScope(client, userId, repoId);
    await assertWithinHackingWindow(client);
    if (!(await isActiveProjectMember(client, repoId, userId))) {
      throw new ForbiddenError("Not a member of this project");
    }
    const count = await activeProjectMemberCount(client, repoId);
    if (count > 1) {
      throw new ConflictError("Remove other members first, or ask queue management");
    }

    const repoRes = await client.query(
      `SELECT id, name, is_test_account FROM repos WHERE id = $1 FOR UPDATE`,
      [repoId],
    );
    const repo = repoRes.rows[0] as
      | { id: number; name: string; is_test_account: boolean }
      | undefined;
    if (!repo) throw new NotFoundError(`Repo ${repoId} not found`);

    const deleted = await deleteRepoCascade(client, repoId, repo.is_test_account === true);

    await audit(client, {
      actorId: userId,
      entityType: "repo",
      entityId: repoId,
      action: "delete",
      before: { name: repo.name },
      source: "participant",
    });
    return deleted;
  });

  // The queue rows no longer exist, so resolve each topic from the marker
  // captured inside the transaction. These are best-effort notifications on
  // top of the committed deletion; they must not become part of its rollback
  // boundary or the idempotent request response (H19/H20, H38/H41).
  for (const entry of queueEntries) {
    await broadcastQueueEventWithMarker(entry.fixtureMarker, EVENTS.QUEUE_ENTRY_CHANGED, {
      id: entry.id,
      challenge_id: entry.challenge_id,
      repo_id: entry.repo_id,
      deleted: true,
    });
  }

  // Queue rows are gone by this point, so the delayed challenge worker cannot
  // discover the deleted team's recipients. Refresh each marker-matched
  // member directly; the payload is only the challenge id and never queue data.
  const participantChallenges = new Set(
    queueEntries.filter((entry) => entry.fixtureMarker !== null).map((entry) => entry.challenge_id),
  );
  await Promise.all(
    [...participantChallenges].flatMap((challengeId) =>
      memberIds.map((memberId) =>
        broadcast(`${SSE_TOPICS.USER_PREFIX}${memberId}`, EVENTS.USER_QUEUE_CHANGED, {
          challengeId,
        }),
      ),
    ),
  );

  const affectedChallenges = [...new Set(queueEntries.map((entry) => entry.challenge_id))];
  for (const challengeId of affectedChallenges) {
    await notifyChallengeQueueChanged(pool, challengeId);
  }

  return { deleted: true };
}

export interface PublicChallenge {
  id: number;
  title: Record<string, string>;
  description: Record<string, string>;
  criteria: Record<string, string>;
  prizes: unknown;
  availableFrom: string | null;
  enterprise: {
    id: number;
    name: string;
    logoUrl: string | null;
    logoNegativeUrl: string | null;
    website: string | null;
  };
}

function translationsOf(i18n: unknown, fallback: string | null): Record<string, string> {
  const translations: Record<string, string> = {};
  if (i18n && typeof i18n === "object" && !Array.isArray(i18n)) {
    for (const [locale, value] of Object.entries(i18n as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) translations[locale] = value;
    }
  }
  if (Object.keys(translations).length === 0 && fallback?.trim()) translations.en = fallback;
  return translations;
}

export async function listPublicChallenges(): Promise<PublicChallenge[]> {
  const { rows } = await pool.query(
    `SELECT c.id,
            c.title,
            c.title_i18n,
            c.description,
            c.description_i18n,
            c.criteria,
            c.criteria_i18n,
            c.prizes,
            c.available_from,
            e.id AS enterprise_id,
            e.name AS enterprise_name,
            e.logo_url AS enterprise_logo_url,
            COALESCE(e.logo_negative_url, e.logo_url) AS enterprise_logo_negative_url,
            e.website AS enterprise_website
       FROM challenges c
       JOIN sponsors s ON s.id = c.author
       JOIN enterprises e ON e.id = s.enterprise_id
      WHERE c.visibility = 'visible' AND c.is_test_account = false
      ORDER BY c.available_from NULLS FIRST, c.id ASC`,
  );

  return (rows as Array<Record<string, unknown>>).map((r) => ({
    id: Number(r.id),
    title: translationsOf(r.title_i18n, String(r.title ?? "")),
    description: translationsOf(r.description_i18n, String(r.description ?? "")),
    criteria: translationsOf(r.criteria_i18n, (r.criteria as string | null) ?? null),
    prizes: r.prizes ?? [],
    availableFrom:
      r.available_from instanceof Date
        ? r.available_from.toISOString()
        : (r.available_from as null),
    enterprise: {
      id: Number(r.enterprise_id),
      name: String(r.enterprise_name),
      logoUrl: (r.enterprise_logo_url as string | null) ?? null,
      logoNegativeUrl: (r.enterprise_logo_negative_url as string | null) ?? null,
      website: (r.enterprise_website as string | null) ?? null,
    },
  }));
}

// Public sponsors moved to the sponsors module (enterprise-driven reveal,
// H45). See apps/api/src/modules/sponsors/service.ts#listPublicSponsors.
