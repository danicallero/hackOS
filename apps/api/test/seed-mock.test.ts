import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";
import { expect, it } from "vitest";
import { migrate } from "../scripts/migrate.js";
import { TEST_DATABASE_URL } from "./test-env.js";

const exec = promisify(execFile);

it("seeds a fresh migrated database and preserves complete fixtures on rerun (#1021)", async () => {
  const databaseName = `hackos_mock_${randomUUID().replaceAll("-", "")}`;
  const databaseUrl = new URL(TEST_DATABASE_URL);
  databaseUrl.pathname = `/${databaseName}`;
  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const client = new pg.Client({ connectionString: databaseUrl.toString() });
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
    await migrate(databaseUrl.toString());
    await client.connect();
    const run = (script: string) =>
      exec("pnpm", ["run", script], {
        env: { ...process.env, DATABASE_URL: databaseUrl.toString() },
        timeout: 30_000,
      });
    // The command must also succeed before the optional bootstrap admin exists.
    await run("seed:mock");
    await run("seed");
    await run("seed:mock");
    const snapshot = async () =>
      (
        await client.query(`SELECT
      (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM roles) AS roles,
      (SELECT count(*)::int FROM applications) AS applications,
      (SELECT count(*)::int FROM application_responses) AS responses,
      (SELECT count(*)::int FROM submissions WHERE status = 'active') AS members,
      (SELECT count(*)::int FROM repos) AS projects,
      (SELECT count(*)::int FROM rooms) AS rooms,
      (SELECT count(*)::int FROM queue_entries) AS entries,
      (SELECT count(*)::int FROM tickets) AS tickets`)
      ).rows[0];
    const first = await snapshot();
    expect(first).toMatchObject({ applications: 1, projects: 4, members: 16, entries: 4 });
    expect(first.responses).toBeGreaterThan(0);
    expect(first.tickets).toBeGreaterThan(0);
    // Existing participant forms are reused by grant even if their name changes.
    await client.query("UPDATE applications SET name = 'Existing enrollment'");
    await run("seed:mock");
    expect(await snapshot()).toEqual(first);
    const broken = await client.query(`SELECT qe.id FROM queue_entries qe
      JOIN queue_group_challenges qgc ON qgc.challenge_id = qe.challenge_id
      JOIN queue_groups qg ON qg.id = qgc.queue_group_id
      LEFT JOIN room_queue_groups rqg ON rqg.queue_group_id = qg.id
      LEFT JOIN room_enterprises re ON re.room_id = rqg.room_id
      LEFT JOIN project_challenges pc ON pc.repo_id = qe.repo_id AND pc.challenge_id = qe.challenge_id
      JOIN project_eligibility pe ON pe.repo_id = qe.repo_id
      WHERE re.enterprise_id IS DISTINCT FROM qg.enterprise_id OR pc.repo_id IS NULL OR NOT pe.eligible`);
    expect(broken.rows).toEqual([]);
    expect(
      (
        await client.query(`SELECT count(*)::int AS count FROM application_responses ar
      JOIN application_form_versions fv ON fv.id = ar.application_form_version_id
      WHERE fv.application_id = ar.application_id`)
      ).rows[0].count,
    ).toBe(first.responses);
  } finally {
    await client.end();
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
    await admin.end();
  }
}, 90_000);
