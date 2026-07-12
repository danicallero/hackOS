import { randomBytes, randomUUID } from "node:crypto";
import { EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { config } from "../../config.js";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { broadcast } from "../../lib/sse.js";
import { enqueueAuthEmail } from "../identity/outbox.js";
import { assertSecondaryEmailAvailable } from "../identity/routes/secondary-email.js";
import { writeQueueHistory } from "../queue/history.js";
import { notifyChallengeQueueChanged } from "../queue/notify.js";
import { compactChallengePositions, nextBottomPosition } from "../queue/ordering.js";
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
      `INSERT INTO repos (name, description, devpost_url, demo_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (devpost_url) WHERE devpost_url IS NOT NULL DO UPDATE
         SET name = EXCLUDED.name,
             description = EXCLUDED.description,
             demo_url = EXCLUDED.demo_url,
             updated_at = now()
       RETURNING id, (xmax = 0) AS was_insert`,
      [repo.title, repo.description, repo.url, repo.demoUrl],
    );
    return { id: rows[0].id, wasInsert: rows[0].was_insert };
  }

  // No Project Url in this row — best-effort dedupe by name among repos
  // that also have no devpost_url (see 0300 migration DELTA note: this
  // case can't use the unique-index upsert, so a second re-import of a
  // URL-less project will only match if the title is identical).
  const existing = await client.query(
    `SELECT id FROM repos WHERE devpost_url IS NULL AND name = $1 LIMIT 1`,
    [repo.title],
  );
  if (existing.rows[0]) {
    await client.query(
      `UPDATE repos SET description = $2, demo_url = $3, updated_at = now() WHERE id = $1`,
      [existing.rows[0].id, repo.description, repo.demoUrl],
    );
    return { id: existing.rows[0].id, wasInsert: false };
  }
  const inserted = await client.query(
    `INSERT INTO repos (name, description, devpost_url, demo_url) VALUES ($1, $2, NULL, $3) RETURNING id`,
    [repo.title, repo.description, repo.demoUrl],
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

    const counts = {
      reposCreated,
      reposUpdated,
      participantsMatched,
      participantsUnmatched,
      prizesSeen: prizeNamesSeen.size,
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
     JOIN repos r ON r.id = dp.repo_id
     WHERE dp.merge_status = 'unmatched'
     ORDER BY r.name, dp.email`,
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
    const existing = await client.query(
      `SELECT * FROM devpost_participants WHERE repo_id = $1 AND email = $2 FOR UPDATE`,
      [repoId, email],
    );
    if (existing.rows.length === 0) {
      throw new NotFoundError(`No devpost participant ${email} for repo ${repoId}`);
    }
    const user = await client.query(`SELECT id FROM users WHERE id = $1`, [userId]);
    if (user.rows.length === 0) throw new NotFoundError(`User ${userId} not found`);

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
  mergeStatus: "manually_linked";
}

const SECONDARY_EMAIL_TTL_HOURS = 24;

/**
 * H6/H16: link an unmatched Devpost email to a hackOS account by registering
 * it as that account's SECONDARY email and firing the platform's normal
 * secondary-email verification (identity, H6) — we do NOT invent a new flow.
 * The participant is linked to the account immediately, so all project and
 * queue reads see the team without waiting for a later import. It still
 * reuses identity's secondary-email verification flow so the new address is
 * verified through the normal account-security mechanism.
 */
export async function linkParticipantSecondary(
  actorId: number,
  repoId: number,
  email: string,
  userId: number,
): Promise<LinkSecondaryResult> {
  let secondaryEmailSent = false;
  await withTransaction(async (client) => {
    const participant = await client.query(
      `SELECT * FROM devpost_participants WHERE repo_id = $1 AND email = $2 FOR UPDATE`,
      [repoId, email],
    );
    if (participant.rows.length === 0) {
      throw new NotFoundError(`No devpost participant ${email} for repo ${repoId}`);
    }
    const userRes = await client.query(`SELECT id, email, name FROM users WHERE id = $1 FOR UPDATE`, [
      userId,
    ]);
    const user = userRes.rows[0] as { id: number; email: string; name: string | null } | undefined;
    if (!user) throw new NotFoundError(`User ${userId} not found`);

    const isPrimaryEmail = user.email.toLowerCase() === email;
    secondaryEmailSent = !isPrimaryEmail;
    if (!isPrimaryEmail) {
      // Uniqueness rule (H6), checked before we touch anything — explicit 409.
      await assertSecondaryEmailAvailable(email, userId);
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
      action: "secondary_email_link_requested",
      before: { mergeStatus: before.merge_status, userId: before.user_id },
      after: { mergeStatus: "manually_linked", userId, secondaryEmailSent: !isPrimaryEmail },
      source: "admin",
    });
  });

  return {
    repoId,
    email,
    userId,
    secondaryEmailSent,
    mergeStatus: "manually_linked",
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
    const existingUser = await client.query(`SELECT id FROM users WHERE email = $1`, [email]);
    if (existingUser.rows[0]) {
      userId = existingUser.rows[0].id;
    } else {
      const created = await client.query(
        `INSERT INTO users (email, email_verified) VALUES ($1, false) RETURNING id`,
        [email],
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
    const challenge = await client.query(
      `SELECT id, devpost_tags FROM challenges WHERE id = $1 FOR UPDATE`,
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

    const repos = await client.query(`SELECT repo_id FROM repo_devpost_prizes WHERE prize = $1`, [
      prizeName,
    ]);
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
}

interface RepoMember {
  userId: number | null;
  email: string;
  name: string | null;
  surname: string | null;
  mergeStatus: string;
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
 */
async function attachMembersAndPrizes(repoRows: RepoRow[]): Promise<RepoWithExtras[]> {
  const ids = repoRows.map((r) => r.id);
  if (ids.length === 0) return [];

  const membersRes = await pool.query(
    `SELECT repo_id, email, name, surname, devpost_username, user_id, merge_status
       FROM devpost_participants
      WHERE repo_id = ANY($1::int[])
      ORDER BY repo_id, name ASC NULLS LAST, surname ASC NULLS LAST, email ASC`,
    [ids],
  );
  const manualMembersRes = await pool.query(
    `SELECT s.repo_id, u.id AS user_id, u.email, u.name, u.surname
       FROM submissions s
       JOIN users u ON u.id = s.user_id
      WHERE s.repo_id = ANY($1::int[])
        AND NOT EXISTS (
          SELECT 1
            FROM devpost_participants dp
           WHERE dp.repo_id = s.repo_id
             AND dp.user_id = s.user_id
        )
      ORDER BY s.repo_id, u.name ASC NULLS LAST, u.surname ASC NULLS LAST, u.email ASC`,
    [ids],
  );
  const prizesRes = await pool.query(
    `SELECT repo_id, prize FROM repo_devpost_prizes WHERE repo_id = ANY($1::int[])`,
    [ids],
  );
  const prizeNames = [...new Set(prizesRes.rows.map((r: { prize: string }) => r.prize))];
  const challengesRes = prizeNames.length
    ? await pool.query(
        `SELECT id, title, devpost_tags FROM challenges WHERE devpost_tags ?| $1::text[]`,
        [prizeNames],
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
            qe.assigned_room_id, r.name AS assigned_room_name
       FROM queue_entries qe
       JOIN challenges c ON c.id = qe.challenge_id
       LEFT JOIN rooms r ON r.id = qe.assigned_room_id
      WHERE qe.repo_id = ANY($1::int[])
        AND qe.status NOT IN ('cancelled', 'disqualified')
      ORDER BY qe.repo_id, qe.position ASC NULLS LAST, qe.id ASC`,
    [ids],
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
  }>) {
    const arr = membersByRepo.get(row.repo_id) ?? [];
    arr.push({
      userId: row.user_id,
      email: row.email,
      name: row.name,
      surname: row.surname,
      mergeStatus: row.merge_status,
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
  }>) {
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

const REPO_SELECT = `SELECT id, name, description, github_url, devpost_url, demo_url FROM repos`;

/** PROJECTS_READ: repos with members, prizes, and mapped challenges. */
export async function listRepos(): Promise<RepoWithExtras[]> {
  const { rows } = await pool.query(`${REPO_SELECT} ORDER BY name`);
  return attachMembersAndPrizes(rows);
}

export async function getRepo(id: number): Promise<RepoWithExtras> {
  const { rows } = await pool.query(`${REPO_SELECT} WHERE id = $1`, [id]);
  if (rows.length === 0) throw new NotFoundError(`Repo ${id} not found`);
  const [withExtras] = await attachMembersAndPrizes(rows);
  if (!withExtras) throw new NotFoundError(`Repo ${id} not found`);
  return withExtras;
}

/**
 * How a non-admin caller reaches Projects (H8, H20, H44/H46):
 *  - `isFullAccess`  → holds `projects:read` (or `*`): sees ALL repos.
 *  - `isJudge`       → holds `judge:panel`: sees repos of the challenges they
 *                      are assigned to judge (room_judges).
 *  - `isSponsor`     → linked in `sponsors`: sees repos of their enterprise's
 *                      authored challenges.
 * Judge/sponsor scopes stack (union). A judge/sponsor with zero challenges gets
 * an empty list, not a 403.
 */
export interface RepoScope {
  isFullAccess: boolean;
  isJudge: boolean;
  isSponsor: boolean;
}

/** Challenge ids a judge is assigned to ∪ a sponsor rep's enterprise challenges. */
async function scopedChallengeIds(userId: number, scope: RepoScope): Promise<number[]> {
  const ids = new Set<number>();
  if (scope.isJudge) {
    // A judge assigned to a room+challenge judges that challenge (H44).
    const { rows } = await pool.query(
      `SELECT DISTINCT challenge_id FROM room_judges WHERE user_id = $1`,
      [userId],
    );
    for (const r of rows as { challenge_id: number }[]) ids.add(r.challenge_id);
  }
  if (scope.isSponsor) {
    // Challenges authored by any sponsor of the same enterprise (H44/H46) —
    // same ownership join used by rooms.routes/roomIdsForSponsorOwner.
    const { rows } = await pool.query(
      `SELECT DISTINCT c.id
         FROM challenges c
         JOIN sponsors author ON author.id = c.author
         JOIN sponsors mine ON mine.enterprise_id = author.enterprise_id
        WHERE mine.user_id = $1`,
      [userId],
    );
    for (const r of rows as { id: number }[]) ids.add(r.id);
  }
  return [...ids];
}

/**
 * Repos of the participants of `challengeIds`: repos with a queue_entry for the
 * challenge, OR repos whose Devpost prizes map to the challenge's devpost_tags
 * (the same challenge↔repo mapping attachMembersAndPrizes surfaces per repo).
 */
async function repoIdsForChallenges(challengeIds: number[]): Promise<number[]> {
  if (challengeIds.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT DISTINCT repo_id FROM (
        SELECT repo_id FROM queue_entries WHERE challenge_id = ANY($1::int[])
        UNION
        SELECT rdp.repo_id
          FROM repo_devpost_prizes rdp
          JOIN challenges c ON c.devpost_tags ? rdp.prize
         WHERE c.id = ANY($1::int[])
     ) s`,
    [challengeIds],
  );
  return rows.map((r: { repo_id: number }) => r.repo_id);
}

/** Repos visible to `userId` under `scope` (H8): all for full-access, else scoped. */
export async function listReposForUser(
  userId: number,
  scope: RepoScope,
): Promise<RepoWithExtras[]> {
  if (scope.isFullAccess) return listRepos();
  const challengeIds = await scopedChallengeIds(userId, scope);
  const repoIds = await repoIdsForChallenges(challengeIds);
  if (repoIds.length === 0) return [];
  const { rows } = await pool.query(`${REPO_SELECT} WHERE id = ANY($1::int[]) ORDER BY name`, [
    repoIds,
  ]);
  return attachMembersAndPrizes(rows);
}

/** Single repo scoped to `userId` — 404 (never leak) if outside their scope. */
export async function getRepoForUser(
  userId: number,
  id: number,
  scope: RepoScope,
): Promise<RepoWithExtras> {
  if (scope.isFullAccess) return getRepo(id);
  const challengeIds = await scopedChallengeIds(userId, scope);
  const repoIds = await repoIdsForChallenges(challengeIds);
  if (!repoIds.includes(id)) throw new NotFoundError(`Repo ${id} not found`);
  return getRepo(id);
}

/**
 * Participant self-view (H20 scope, minimal): repos this user is a member of.
 *
 * Membership must match what every other project/queue roster surfaces via
 * attachMembersAndPrizes — a user counts as a member if they have a submission
 * OR are a matched Devpost participant (`devpost_participants.user_id`).
 * `removeRepoMember` clears that link when it removes the corresponding
 * submission, so all membership surfaces stop agreeing that the user belongs to
 * the project at the same time.
 */
export async function myProjects(userId: number): Promise<Array<Omit<RepoWithExtras, "members">>> {
  const { rows } = await pool.query(
    `SELECT r.id, r.name, r.description, r.github_url, r.devpost_url, r.demo_url
     FROM repos r
     WHERE r.id IN (
       SELECT repo_id FROM submissions WHERE user_id = $1
       UNION
       SELECT repo_id FROM devpost_participants WHERE user_id = $1
       UNION
       SELECT dp.repo_id
         FROM devpost_participants dp
         JOIN users u ON u.id = $1
        WHERE lower(dp.email) = lower(u.email)
           OR (u.secondary_email_verified_at IS NOT NULL
               AND lower(dp.email) = lower(u.secondary_email))
     )
     ORDER BY r.name`,
    [userId],
  );
  const withExtras = await attachMembersAndPrizes(rows);
  return withExtras.map(({ members: _members, ...rest }) => rest);
}

export async function addRepoMember(actorId: number, repoId: number, userId: number) {
  return withTransaction(async (client) => {
    const repo = await client.query(`SELECT id FROM repos WHERE id = $1 FOR UPDATE`, [repoId]);
    if (!repo.rows[0]) throw new NotFoundError(`Repo ${repoId} not found`);
    const user = await client.query(`SELECT id FROM users WHERE id = $1`, [userId]);
    if (!user.rows[0]) throw new NotFoundError(`User ${userId} not found`);

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
    const existing = await client.query(
      `SELECT * FROM submissions WHERE repo_id = $1 AND user_id = $2 FOR UPDATE`,
      [repoId, userId],
    );
    if (!existing.rows[0]) throw new NotFoundError(`Repo member ${repoId}:${userId} not found`);

    await client.query(`DELETE FROM submissions WHERE repo_id = $1 AND user_id = $2`, [
      repoId,
      userId,
    ]);

    // Keep the imported Devpost row (email/name/import batch) for audit and a
    // future reconciliation, but detach its account link. A matched Devpost row
    // is otherwise also treated as roster membership by project/profile reads.
    const detached = await client.query(
      `UPDATE devpost_participants
          SET user_id = NULL, merge_status = 'unmatched'
        WHERE repo_id = $1 AND user_id = $2
        RETURNING email, merge_status`,
      [repoId, userId],
    );
    await audit(client, {
      actorId,
      entityType: "submission",
      entityId: `${repoId}:${userId}`,
      action: "remove_member",
      before: { repoId, userId },
      after: {
        repoId,
        userId,
        detachedDevpostParticipants: detached.rows.map((row: { email: string }) => row.email),
      },
      source: "admin",
    });
    return { repoId, userId, removed: true };
  });
}

export async function removeDevpostParticipant(actorId: number, repoId: number, email: string) {
  return withTransaction(async (client) => {
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
          WHERE repo_id = $1 AND user_id = $2 AND imported_from = 'devpost'`,
        [repoId, participant.user_id],
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

export async function addRepoChallenge(actorId: number, repoId: number, challengeId: number) {
  const result = await withTransaction(async (client) => {
    const repo = await client.query(`SELECT id FROM repos WHERE id = $1 FOR UPDATE`, [repoId]);
    if (!repo.rows[0]) throw new NotFoundError(`Repo ${repoId} not found`);
    const challenge = await client.query(`SELECT id FROM challenges WHERE id = $1`, [challengeId]);
    if (!challenge.rows[0]) throw new NotFoundError(`Challenge ${challengeId} not found`);

    const existing = await client.query(
      `SELECT * FROM queue_entries WHERE repo_id = $1 AND challenge_id = $2 FOR UPDATE`,
      [repoId, challengeId],
    );
    if (existing.rows[0]) {
      const entry = existing.rows[0] as { id: number; status: string };
      if (["cancelled", "disqualified", "completed"].includes(entry.status)) {
        const position = await nextBottomPosition(client, challengeId);
        const revived = await client.query(
          `UPDATE queue_entries
              SET status = 'waiting', position = $1, assigned_room_id = NULL,
                  called_at = NULL, presentation_started_at = NULL, completed_at = NULL
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
          source: "admin",
        });
        return { repoId, challengeId, entry: revived.rows[0], inserted: false, revived: true };
      }
      return { repoId, challengeId, entry: null, inserted: false, revived: false };
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
      source: "admin",
    });
    return { repoId, challengeId, entry, inserted: true, revived: false };
  });
  if (result.entry) {
    await broadcast(SSE_TOPICS.QUEUE, EVENTS.QUEUE_ENTRY_CHANGED, result.entry);
    await notifyChallengeQueueChanged(pool, result.entry.challenge_id);
  }
  return result;
}

export async function removeRepoChallenge(actorId: number, repoId: number, challengeId: number) {
  const result = await withTransaction(async (client) => {
    const entryRes = await client.query(
      `SELECT * FROM queue_entries WHERE repo_id = $1 AND challenge_id = $2 FOR UPDATE`,
      [repoId, challengeId],
    );
    const entry = entryRes.rows[0];
    if (!entry)
      throw new NotFoundError(`Repo ${repoId} is not assigned to challenge ${challengeId}`);

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
      reason: "Removed from challenge",
    });
    await audit(client, {
      actorId,
      entityType: "queue_entry",
      entityId: entry.id,
      action: "remove_from_challenge",
      before: { status: entry.status, challengeId, repoId },
      after: { status: nextStatus },
      reason: "Removed from challenge",
      source: "admin",
    });
    await compactChallengePositions(client, challengeId);
    return { repoId, challengeId, entry: updated.rows[0], removed: true };
  });
  await broadcast(SSE_TOPICS.QUEUE, EVENTS.QUEUE_ENTRY_CHANGED, result.entry);
  await notifyChallengeQueueChanged(pool, result.entry.challenge_id);
  return result;
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
      WHERE c.visibility = 'visible'
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
