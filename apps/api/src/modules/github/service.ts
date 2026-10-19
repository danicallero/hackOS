import { ERROR_REASONS } from "@hackos/shared/error-reasons";
import type { PoolClient } from "pg";
import { pool, withTransaction } from "../../db/pool.js";
import { audit } from "../../lib/audit.js";
import { ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors.js";
import {
  type GithubCommit,
  type GithubPull,
  listCommits,
  listInstallationRepos,
  listPulls,
} from "./client.js";

export async function assertActiveMember(userId: number, repoId: number): Promise<void> {
  const { rowCount } = await pool.query(
    `SELECT 1 FROM submissions WHERE repo_id = $1 AND user_id = $2 AND status = 'active'`,
    [repoId, userId],
  );
  if (!rowCount) throw new ForbiddenError("Only project members can manage the GitHub link");
}

/** Hacking window when set, else the event window; either end may be open. */
async function activityWindow(): Promise<{ from: string | null; to: string | null }> {
  const { rows } = await pool.query(
    `SELECT COALESCE(hacking_starts_at, event_starts_at) AS "from",
            COALESCE(hacking_ends_at, event_ends_at) AS "to"
       FROM event_config WHERE id = 1`,
  );
  return {
    from: rows[0]?.from ? new Date(rows[0].from).toISOString() : null,
    to: rows[0]?.to ? new Date(rows[0].to).toISOString() : null,
  };
}

export async function linkStatus(repoId: number) {
  const { rows } = await pool.query(
    `SELECT full_name AS "fullName", is_private AS "isPrivate" FROM github_repo_links WHERE repo_id = $1`,
    [repoId],
  );
  return rows[0] ?? null;
}

export async function saveUserAuthorization(
  userId: number,
  account: { githubId: number; login: string; installationIds: number[] },
  installationId: number,
): Promise<void> {
  if (!account.installationIds.includes(installationId))
    throw new ForbiddenError("This GitHub installation does not belong to your account");
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM github_accounts WHERE github_id = $1 AND user_id <> $2`, [
      account.githubId,
      userId,
    ]);
    await client.query(
      `INSERT INTO github_accounts (user_id, github_id, login) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET github_id = EXCLUDED.github_id, login = EXCLUDED.login`,
      [userId, account.githubId, account.login],
    );
    await client.query(
      `INSERT INTO github_user_installations (user_id, installation_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [userId, installationId],
    );
  });
}

export async function saveAccount(
  userId: number,
  account: { githubId: number; login: string },
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM github_accounts WHERE github_id = $1 AND user_id <> $2`, [
      account.githubId,
      userId,
    ]);
    await client.query(
      `INSERT INTO github_accounts (user_id, github_id, login) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET github_id = EXCLUDED.github_id, login = EXCLUDED.login`,
      [userId, account.githubId, account.login],
    );
    await audit(client, {
      actorId: userId,
      entityType: "github_account",
      entityId: userId,
      action: "link",
      after: { login: account.login },
    });
  });
}

/** Installations GitHub says the member can reach, so repos can be chosen without another redirect. */
export async function saveInstallations(userId: number, installationIds: number[]): Promise<void> {
  for (const installationId of installationIds)
    await pool.query(
      `INSERT INTO github_user_installations (user_id, installation_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [userId, installationId],
    );
}

export async function accountStatus(userId: number) {
  const { rows } = await pool.query(`SELECT login FROM github_accounts WHERE user_id = $1`, [
    userId,
  ]);
  return rows[0] ?? null;
}

export async function unlinkAccount(userId: number): Promise<void> {
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `DELETE FROM github_accounts WHERE user_id = $1 RETURNING login`,
      [userId],
    );
    if (!rows[0]) throw new NotFoundError("No GitHub account is linked");
    await client.query(`DELETE FROM github_user_installations WHERE user_id = $1`, [userId]);
    await audit(client, {
      actorId: userId,
      entityType: "github_account",
      entityId: userId,
      action: "unlink",
      before: { login: rows[0].login },
    });
  });
}

export async function installationsOf(userId: number): Promise<number[]> {
  const { rows } = await pool.query(
    `SELECT installation_id FROM github_user_installations WHERE user_id = $1`,
    [userId],
  );
  return rows.map((row) => Number(row.installation_id));
}

export async function selectableRepos(userId: number) {
  const out: { installationId: number; id: number; fullName: string; isPrivate: boolean }[] = [];
  let failure: unknown = null;
  const installations = await installationsOf(userId);
  for (const installationId of installations) {
    try {
      for (const repo of await listInstallationRepos(installationId))
        out.push({
          installationId,
          id: repo.id,
          fullName: repo.full_name,
          isPrivate: repo.private,
        });
    } catch (err) {
      failure = err;
    }
  }
  // Every installation failing is an error to show, not an empty list.
  if (failure && installations.length > 0 && out.length === 0) throw failure;
  return out;
}

/** H20/H21: a submitted project is frozen, so its repository changes only after withdrawal or staff return. */
async function assertNotFrozen(client: PoolClient, repoId: number): Promise<void> {
  const { rows } = await client.query(
    `SELECT submission_status FROM repos WHERE id = $1 FOR UPDATE`,
    [repoId],
  );
  if (rows[0]?.submission_status === "submitted")
    throw new ConflictError("Withdraw the submission to edit the project", {
      code: ERROR_REASONS.PROJECT_FROZEN,
    });
}

export async function linkRepo(userId: number, repoId: number, githubRepoId: number) {
  const choice = (await selectableRepos(userId)).find((repo) => repo.id === githubRepoId);
  if (!choice)
    throw new NotFoundError("Repository not available in your GitHub installations", {
      code: ERROR_REASONS.GITHUB_REPO_NOT_AVAILABLE,
    });
  await withTransaction(async (client) => {
    await assertNotFrozen(client, repoId);
    const taken = await client.query(
      `SELECT repo_id FROM github_repo_links WHERE github_repo_id = $1 AND repo_id <> $2`,
      [githubRepoId, repoId],
    );
    if (taken.rowCount)
      throw new ConflictError("This repository is already linked to a project", {
        code: ERROR_REASONS.GITHUB_REPO_ALREADY_LINKED,
      });
    const { rows: previous } = await client.query(
      `SELECT full_name FROM github_repo_links WHERE repo_id = $1`,
      [repoId],
    );
    await client.query(
      `INSERT INTO github_repo_links (repo_id, installation_id, github_repo_id, full_name, is_private, linked_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (repo_id) DO UPDATE SET installation_id = EXCLUDED.installation_id,
         github_repo_id = EXCLUDED.github_repo_id, full_name = EXCLUDED.full_name,
         is_private = EXCLUDED.is_private, linked_by = EXCLUDED.linked_by`,
      [repoId, choice.installationId, githubRepoId, choice.fullName, choice.isPrivate, userId],
    );
    // The project's URL follows its link: filled when empty, and replaced when it was
    // the previous link's address. A URL a person typed for another place is kept.
    await client.query(
      `UPDATE repos SET github_url = $2
        WHERE id = $1
          AND (github_url IS NULL OR github_url = ''
               OR ($3::text IS NOT NULL AND github_url = 'https://github.com/' || $3))`,
      [repoId, `https://github.com/${choice.fullName}`, previous[0]?.full_name ?? null],
    );
    await audit(client, {
      actorId: userId,
      entityType: "project_github_link",
      entityId: repoId,
      action: "link",
      after: { fullName: choice.fullName, isPrivate: choice.isPrivate },
    });
  });
  return {
    fullName: choice.fullName,
    isPrivate: choice.isPrivate,
    installationId: choice.installationId,
  };
}

export async function unlinkRepo(userId: number, repoId: number): Promise<void> {
  await withTransaction(async (client) => {
    await assertNotFrozen(client, repoId);
    const { rows } = await client.query(
      `DELETE FROM github_repo_links WHERE repo_id = $1 RETURNING full_name`,
      [repoId],
    );
    if (!rows[0]) throw new NotFoundError("No GitHub repository is linked");
    await client.query(
      `UPDATE repos SET github_url = NULL
        WHERE id = $1 AND github_url = 'https://github.com/' || $2::text`,
      [repoId, rows[0].full_name],
    );
    await client.query(`DELETE FROM github_commits WHERE repo_id = $1`, [repoId]);
    await client.query(`DELETE FROM github_pull_requests WHERE repo_id = $1`, [repoId]);
    await audit(client, {
      actorId: userId,
      entityType: "project_github_link",
      entityId: repoId,
      action: "unlink",
      before: { fullName: rows[0].full_name },
    });
  });
}

export async function recordCommits(
  db: Pick<PoolClient, "query">,
  repoId: number,
  commits: GithubCommit[],
): Promise<void> {
  for (const commit of commits)
    await db.query(
      `INSERT INTO github_commits (repo_id, sha, author_login, committed_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (repo_id, sha) DO NOTHING`,
      [repoId, commit.sha, commit.login, commit.at],
    );
}

export async function recordPull(
  db: Pick<PoolClient, "query">,
  repoId: number,
  pull: GithubPull,
): Promise<void> {
  await db.query(
    `INSERT INTO github_pull_requests (repo_id, number, author_login, state, merged_at, opened_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (repo_id, number) DO UPDATE SET state = EXCLUDED.state,
       merged_at = EXCLUDED.merged_at, author_login = EXCLUDED.author_login`,
    [repoId, pull.number, pull.login, pull.state, pull.mergedAt, pull.openedAt],
  );
}

/** Seeds history from before the link; the webhook keeps it current afterwards. */
export async function backfill(repoId: number): Promise<void> {
  const { rows } = await pool.query(
    `SELECT installation_id, full_name FROM github_repo_links WHERE repo_id = $1`,
    [repoId],
  );
  const link = rows[0];
  if (!link) return;
  const { from } = await activityWindow();
  const installationId = Number(link.installation_id);
  const [commits, pulls] = await Promise.all([
    listCommits(installationId, link.full_name, from),
    listPulls(installationId, link.full_name),
  ]);
  await withTransaction(async (client) => {
    await recordCommits(client, repoId, commits);
    for (const pull of pulls) await recordPull(client, repoId, pull);
  });
}

export async function repoForGithubId(githubRepoId: number): Promise<number | null> {
  const { rows } = await pool.query(
    `SELECT repo_id FROM github_repo_links WHERE github_repo_id = $1`,
    [githubRepoId],
  );
  return rows[0] ? Number(rows[0].repo_id) : null;
}

export async function removeInstallation(installationId: number): Promise<void> {
  await pool.query(`DELETE FROM github_repo_links WHERE installation_id = $1`, [installationId]);
  await pool.query(`DELETE FROM github_user_installations WHERE installation_id = $1`, [
    installationId,
  ]);
}

const TOP = 10;

export interface LeaderboardRow {
  name: string;
  count: number;
  merged?: number;
}

/** Top committers and pull requests inside the activity window, per person and per team. */
export async function leaderboard() {
  const { from, to } = await activityWindow();
  const window = [from, to];
  const inWindow = (column: string) =>
    `($1::timestamptz IS NULL OR ${column} >= $1) AND ($2::timestamptz IS NULL OR ${column} <= $2)`;
  const [commitPeople, commitTeams, prPeople, prTeams] = await Promise.all([
    pool.query(
      `SELECT COALESCE(NULLIF(trim(concat_ws(' ', u.name, u.surname)), ''), c.author_login) AS name, count(*)::int AS count
         FROM github_commits c JOIN repos r ON r.id = c.repo_id
         LEFT JOIN github_accounts ga ON lower(ga.login) = lower(c.author_login)
         LEFT JOIN users u ON u.id = ga.user_id
        WHERE r.is_test_account = false AND c.author_login IS NOT NULL AND ${inWindow("c.committed_at")}
        GROUP BY c.author_login, u.name, u.surname ORDER BY count DESC, name LIMIT ${TOP}`,
      window,
    ),
    pool.query(
      `SELECT r.name, count(*)::int AS count
         FROM github_commits c JOIN repos r ON r.id = c.repo_id
        WHERE r.is_test_account = false AND ${inWindow("c.committed_at")}
        GROUP BY r.id, r.name ORDER BY count DESC, r.name LIMIT ${TOP}`,
      window,
    ),
    pool.query(
      `SELECT COALESCE(NULLIF(trim(concat_ws(' ', u.name, u.surname)), ''), p.author_login) AS name, count(*)::int AS count, count(p.merged_at)::int AS merged
         FROM github_pull_requests p JOIN repos r ON r.id = p.repo_id
         LEFT JOIN github_accounts ga ON lower(ga.login) = lower(p.author_login)
         LEFT JOIN users u ON u.id = ga.user_id
        WHERE r.is_test_account = false AND p.author_login IS NOT NULL AND ${inWindow("p.opened_at")}
        GROUP BY p.author_login, u.name, u.surname ORDER BY count DESC, merged DESC, name LIMIT ${TOP}`,
      window,
    ),
    pool.query(
      `SELECT r.name, count(*)::int AS count, count(p.merged_at)::int AS merged
         FROM github_pull_requests p JOIN repos r ON r.id = p.repo_id
        WHERE r.is_test_account = false AND ${inWindow("p.opened_at")}
        GROUP BY r.id, r.name ORDER BY count DESC, merged DESC, r.name LIMIT ${TOP}`,
      window,
    ),
  ]);
  return {
    commits: {
      people: commitPeople.rows as LeaderboardRow[],
      teams: commitTeams.rows as LeaderboardRow[],
    },
    pullRequests: {
      people: prPeople.rows as LeaderboardRow[],
      teams: prTeams.rows as LeaderboardRow[],
    },
  };
}

export interface TeamActivity {
  repoId: number;
  commits: number;
  pullRequests: number;
  merged: number;
}

export interface PersonActivity {
  login: string;
  name: string | null;
  commits: number;
  pullRequests: number;
  merged: number;
}

const windowFilter = (column: string, from: number, to: number) =>
  `($${from}::timestamptz IS NULL OR ${column} >= $${from}) AND ($${to}::timestamptz IS NULL OR ${column} <= $${to})`;

/** Commit and pull-request totals per linked project inside the activity window (H18). */
export async function teamActivity(): Promise<TeamActivity[]> {
  const { from, to } = await activityWindow();
  const { rows } = await pool.query(
    `SELECT l.repo_id AS "repoId",
            (SELECT count(*)::int FROM github_commits c
              WHERE c.repo_id = l.repo_id AND ${windowFilter("c.committed_at", 1, 2)}) AS commits,
            (SELECT count(*)::int FROM github_pull_requests p
              WHERE p.repo_id = l.repo_id AND ${windowFilter("p.opened_at", 1, 2)}) AS "pullRequests",
            (SELECT count(p.merged_at)::int FROM github_pull_requests p
              WHERE p.repo_id = l.repo_id AND ${windowFilter("p.opened_at", 1, 2)}) AS merged
       FROM github_repo_links l`,
    [from, to],
  );
  return rows;
}

/** Commit and pull-request totals per GitHub author of one project; linked accounts show their member name. */
export async function personActivity(repoId: number): Promise<PersonActivity[]> {
  const { from, to } = await activityWindow();
  const { rows } = await pool.query(
    `WITH activity AS (
       SELECT lower(c.author_login) AS login, 1 AS commits, 0 AS pulls, 0 AS merged
         FROM github_commits c
        WHERE c.repo_id = $1 AND c.author_login IS NOT NULL AND ${windowFilter("c.committed_at", 2, 3)}
       UNION ALL
       SELECT lower(p.author_login), 0, 1, (p.merged_at IS NOT NULL)::int
         FROM github_pull_requests p
        WHERE p.repo_id = $1 AND p.author_login IS NOT NULL AND ${windowFilter("p.opened_at", 2, 3)}
     )
     SELECT a.login,
            NULLIF(trim(concat_ws(' ', u.name, u.surname)), '') AS name,
            sum(a.commits)::int AS commits,
            sum(a.pulls)::int AS "pullRequests",
            sum(a.merged)::int AS merged
       FROM activity a
       LEFT JOIN github_accounts ga ON lower(ga.login) = a.login
       LEFT JOIN users u ON u.id = ga.user_id
      GROUP BY a.login, u.name, u.surname
      ORDER BY sum(a.commits) + sum(a.pulls) DESC, a.login`,
    [repoId, from, to],
  );
  return rows;
}

export interface ProjectActivityTotals {
  commits: number;
  pullRequests: number;
  merged: number;
}

/** One project's commit and pull-request totals inside the activity window (H18). */
export async function projectActivityTotals(repoId: number): Promise<ProjectActivityTotals> {
  const { from, to } = await activityWindow();
  const { rows } = await pool.query(
    `SELECT (SELECT count(*)::int FROM github_commits c
              WHERE c.repo_id = $1 AND ${windowFilter("c.committed_at", 2, 3)}) AS commits,
            (SELECT count(*)::int FROM github_pull_requests p
              WHERE p.repo_id = $1 AND ${windowFilter("p.opened_at", 2, 3)}) AS "pullRequests",
            (SELECT count(p.merged_at)::int FROM github_pull_requests p
              WHERE p.repo_id = $1 AND ${windowFilter("p.opened_at", 2, 3)}) AS merged`,
    [repoId, from, to],
  );
  return rows[0];
}
