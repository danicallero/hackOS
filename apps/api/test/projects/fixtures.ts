import { pool } from "../../src/db/pool.js";
import { ensureApplicationFormVersion, grantAttendeeRole } from "../helpers.js";

/** challenges.author needs a sponsor -> enterprise chain. */
export async function createChallenge(
  title: string,
  options: { mandatory?: boolean; visible?: boolean } = {},
): Promise<number> {
  const suffix = crypto.randomUUID();
  const owner = await pool.query(
    `INSERT INTO users (email, email_verified) VALUES ($1, true) RETURNING id`,
    [`sponsor-${suffix}@test.local`],
  );
  const enterprise = await pool.query(`INSERT INTO enterprises (name) VALUES ($1) RETURNING id`, [
    `Enterprise ${suffix}`,
  ]);
  const sponsor = await pool.query(
    `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
    [enterprise.rows[0].id, owner.rows[0].id],
  );
  const challenge = await pool.query(
    `INSERT INTO challenges (author, title, mandatory, visibility) VALUES ($1, $2, $3, $4) RETURNING id`,
    [
      sponsor.rows[0].id,
      title,
      options.mandatory === true,
      options.visible === true ? "visible" : "hidden",
    ],
  );
  return challenge.rows[0].id;
}

/**
 * H19/H20 self-service eligibility: an admitted participant has both the
 * historical accepted application response and the event-bearing Participant
 * role that now drives app/ticket entitlement. Inserts a throwaway
 * `applications` row to hang it off, mirroring a real accepted participant
 * application and its resulting role assignment.
 */
export async function admitParticipant(userId: number): Promise<void> {
  const application = await pool.query(
    `INSERT INTO applications (name, template) VALUES ($1, '{}'::jsonb) RETURNING id`,
    [`Test application ${crypto.randomUUID()}`],
  );
  const formVersionId = await ensureApplicationFormVersion(application.rows[0].id);
  await pool.query(
    `INSERT INTO application_responses
       (user_id, application_id, application_form_version_id, status)
     VALUES ($1, $2, $3, 'accepted')`,
    [userId, application.rows[0].id, formVersionId],
  );
  await grantAttendeeRole(userId, "participant");
}

/**
 * H19/H20 hacking-window gate: writes `event_config.hacking_starts_at` /
 * `hacking_ends_at` directly. `open=true` sets a window comfortably
 * spanning "now"; `open=false` clears both bounds (unset reads as closed,
 * not unrestricted — see `src/lib/hacking-window.ts`). Direct SQL bypasses
 * the API, so no realtime event is emitted for the seed itself.
 */
export async function setHackingWindow(open: boolean): Promise<void> {
  const [startsAt, endsAt] = open
    ? [new Date(Date.now() - 60 * 60 * 1000), new Date(Date.now() + 60 * 60 * 1000)]
    : [null, null];
  await pool.query(
    `INSERT INTO event_config (id, hacking_starts_at, hacking_ends_at) VALUES (1, $1, $2)
     ON CONFLICT (id) DO UPDATE SET hacking_starts_at = $1, hacking_ends_at = $2`,
    [startsAt, endsAt],
  );
}

/**
 * A project with an active roster and an optional challenge selection
 * (#1006). Direct SQL, so no audit or queue side effects: queue entries only
 * appear once a test generates the challenge's queue.
 */
export async function createProject(
  memberIds: number[],
  options: { name?: string; status?: "draft" | "submitted"; challengeIds?: number[] } = {},
): Promise<number> {
  const status = options.status ?? "submitted";
  const { rows } = await pool.query(
    `INSERT INTO repos (name, submission_status, submitted_via, submitted_at)
     VALUES ($1, $2, CASE WHEN $2 = 'submitted' THEN 'admin' END,
             CASE WHEN $2 = 'submitted' THEN now() END)
     RETURNING id`,
    [options.name ?? `Project ${crypto.randomUUID().slice(0, 8)}`, status],
  );
  const repoId = Number(rows[0].id);
  for (const userId of memberIds) {
    await pool.query(
      `INSERT INTO submissions (repo_id, user_id, status) VALUES ($1, $2, 'active')`,
      [repoId, userId],
    );
  }
  for (const challengeId of options.challengeIds ?? []) {
    await pool.query(`INSERT INTO project_challenges (repo_id, challenge_id) VALUES ($1, $2)`, [
      repoId,
      challengeId,
    ]);
  }
  return repoId;
}
