import { randomBytes, randomUUID } from "node:crypto";
import type { Queryable } from "../../db/pool.js";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { ConflictError, NotFoundError } from "../../lib/errors.js";
import { buildImportPlan, type ImportPlan, type PlannedRepo } from "./plan.js";

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

interface RepoWithExtras extends RepoRow {
  members: Array<{
    email: string;
    name: string | null;
    surname: string | null;
    devpostUsername: string | null;
    userId: number | null;
    mergeStatus: string;
  }>;
  prizes: string[];
  challenges: Array<{ id: number; title: string }>;
}

async function attachMembersAndPrizes(repoRows: RepoRow[]): Promise<RepoWithExtras[]> {
  const ids = repoRows.map((r) => r.id);
  if (ids.length === 0) return [];

  const membersRes = await pool.query(
    `SELECT repo_id, email, name, surname, devpost_username, user_id, merge_status
     FROM devpost_participants WHERE repo_id = ANY($1::int[])`,
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
    }
  }

  const membersByRepo = new Map<number, RepoWithExtras["members"]>();
  for (const m of membersRes.rows as Array<{
    repo_id: number;
    email: string;
    name: string | null;
    surname: string | null;
    devpost_username: string | null;
    user_id: number | null;
    merge_status: string;
  }>) {
    const arr = membersByRepo.get(m.repo_id) ?? [];
    arr.push({
      email: m.email,
      name: m.name,
      surname: m.surname,
      devpostUsername: m.devpost_username,
      userId: m.user_id,
      mergeStatus: m.merge_status,
    });
    membersByRepo.set(m.repo_id, arr);
  }
  const prizesByRepo = new Map<number, string[]>();
  for (const p of prizesRes.rows as Array<{ repo_id: number; prize: string }>) {
    const arr = prizesByRepo.get(p.repo_id) ?? [];
    arr.push(p.prize);
    prizesByRepo.set(p.repo_id, arr);
  }

  return repoRows.map((repo) => {
    const prizes = prizesByRepo.get(repo.id) ?? [];
    const challengesSeen = new Map<number, { id: number; title: string }>();
    for (const prize of prizes) {
      for (const c of challengesByPrize.get(prize) ?? []) challengesSeen.set(c.id, c);
    }
    return {
      ...repo,
      members: membersByRepo.get(repo.id) ?? [],
      prizes,
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

/** Participant self-view (H20 scope, minimal): repos I have a submission on. */
export async function myProjects(userId: number): Promise<Array<Omit<RepoWithExtras, "members">>> {
  const { rows } = await pool.query(
    `SELECT r.id, r.name, r.description, r.github_url, r.devpost_url, r.demo_url
     FROM repos r
     JOIN submissions s ON s.repo_id = r.id
     WHERE s.user_id = $1
     ORDER BY r.name`,
    [userId],
  );
  const withExtras = await attachMembersAndPrizes(rows);
  return withExtras.map(({ members: _members, ...rest }) => rest);
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
      website: (r.enterprise_website as string | null) ?? null,
    },
  }));
}

// Public sponsors moved to the sponsors module (enterprise-driven reveal,
// H45). See apps/api/src/modules/sponsors/service.ts#listPublicSponsors.
