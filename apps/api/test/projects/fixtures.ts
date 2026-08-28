import { pool } from "../../src/db/pool.js";
import { ensureApplicationFormVersion } from "../helpers.js";

/**
 * Devpost-shaped CSV fixtures (H16). Header names mirror real Devpost
 * exports: the projects export uses "Project Title" / "Submission Url" /
 * "Opt-In Prizes" / numbered "Team Member N Email" columns; the
 * participants export uses "First Name" / "Last Name" / "Email" /
 * "Username" / "Project Title".
 */

export const EMAILS = {
  alice: "alice@primary.test", // matches a user's primary email
  bobPrimary: "bob@primary.test",
  bobDevpost: "bob@devpost.test", // Bob's VERIFIED secondary email (H6)
  carolPrimary: "carol@primary.test",
  carolDevpost: "carol@devpost.test", // Carol's UNVERIFIED secondary — must NOT match
  dave: "dave@nowhere.test", // no account at all
  eve: "eve@lost.test", // participant row pointing at a nonexistent project
  frank: "frank@nowhere.test", // only present in the projects CSV team columns
};

export const PROJECT_URLS = {
  neuralBeans: "https://devpost.com/software/neural-beans",
  rustaceanStation: "https://devpost.com/software/rustacean-station",
};

export function projectsCsv(): string {
  return [
    `"Project Title","Submission Url","About The Project","""Try it out"" Links","Video Demo Link","Opt-In Prizes","Built With","Team Member 1 Email","Team Member 2 Email","Team Member 3 Email"`,
    `"Neural Beans","${PROJECT_URLS.neuralBeans}","An AI that roasts your coffee and your code.","https://beans.example.com","https://youtu.be/beans","Best AI Hack, Most Caffeinated","python,pytorch","${EMAILS.alice}","${EMAILS.bobDevpost}","${EMAILS.frank}"`,
    `"Rustacean Station","${PROJECT_URLS.rustaceanStation}","A space station simulator written in Rust.","","","Best AI Hack","rust","${EMAILS.carolDevpost}","${EMAILS.dave}",""`,
  ].join("\n");
}

export function participantsCsv(): string {
  return [
    `"First Name","Last Name","Email","Username","Project Title"`,
    `"Alice","Álvarez","${EMAILS.alice}","alice_dev","Neural Beans"`,
    `"Bob","Barreiro","${EMAILS.bobDevpost}","bobb","Neural Beans"`,
    `"Carol","Castro","${EMAILS.carolDevpost}","carolc","Rustacean Station"`,
    `"Dave","Doval","${EMAILS.dave}","daved","Rustacean Station"`,
    `"Eve","Estévez","${EMAILS.eve}","evee","Ghost Project"`,
  ].join("\n");
}

/** Same files, second export: description changed, one prize added. */
export function projectsCsvV2(): string {
  return projectsCsv().replace(
    "An AI that roasts your coffee and your code.",
    "An AI that roasts your coffee, your code, and your team.",
  );
}

export interface SeededUsers {
  aliceId: number;
  bobId: number;
  carolId: number;
}

/** Users the fixture emails should (and should not) match. */
export async function seedMatchableUsers(): Promise<SeededUsers> {
  const alice = await pool.query(
    `INSERT INTO users (email, name, surname, email_verified) VALUES ($1, 'Alice', 'Álvarez', true) RETURNING id`,
    [EMAILS.alice],
  );
  const bob = await pool.query(
    `INSERT INTO users (email, name, surname, email_verified, secondary_email, secondary_email_verified_at)
     VALUES ($1, 'Bob', 'Barreiro', true, $2, now()) RETURNING id`,
    [EMAILS.bobPrimary, EMAILS.bobDevpost],
  );
  const carol = await pool.query(
    `INSERT INTO users (email, name, surname, email_verified, secondary_email, secondary_email_verified_at)
     VALUES ($1, 'Carol', 'Castro', true, $2, NULL) RETURNING id`,
    [EMAILS.carolPrimary, EMAILS.carolDevpost],
  );
  return { aliceId: alice.rows[0].id, bobId: bob.rows[0].id, carolId: carol.rows[0].id };
}

/** challenges.author needs a sponsor -> enterprise chain. */
export async function createChallenge(title: string, devpostTags: string[]): Promise<number> {
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
    `INSERT INTO challenges (author, title, devpost_tags) VALUES ($1, $2, $3::jsonb) RETURNING id`,
    [sponsor.rows[0].id, title, JSON.stringify(devpostTags)],
  );
  return challenge.rows[0].id;
}

/**
 * H19/H20 self-service eligibility: `isAdmittedParticipant` only needs an
 * `application_responses` row in ('accepted', 'confirmed') for that user —
 * any application type. Inserts a throwaway `applications` row to hang it
 * off, mirroring what a real accepted participant application looks like.
 */
export async function admitParticipant(userId: number): Promise<void> {
  const application = await pool.query(
    `INSERT INTO applications (name, type, template) VALUES ($1, 'participant', '{}'::jsonb) RETURNING id`,
    [`Test application ${crypto.randomUUID()}`],
  );
  const formVersionId = await ensureApplicationFormVersion(application.rows[0].id);
  await pool.query(
    `INSERT INTO application_responses
       (user_id, application_id, application_form_version_id, status)
     VALUES ($1, $2, $3, 'accepted')`,
    [userId, application.rows[0].id, formVersionId],
  );
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
