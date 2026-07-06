import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../src/app.js";
import { buildTestApp, truncateAll } from "./helpers.js";

let app: App;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../src/lib/valkey.js");
  await valkey.flushdb();
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../src/lib/queues.js");
  const { closeValkey } = await import("../src/lib/valkey.js");
  const { pool } = await import("../src/db/pool.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

async function getApp(): Promise<App> {
  if (!app) app = await buildTestApp();
  return app;
}

describe("public content catalog (H48, H49)", () => {
  it("lists only visible/published activities, challenges and sponsors without auth", async () => {
    const { pool } = await import("../src/db/pool.js");

    const ownerA = await pool.query(
      `INSERT INTO users (email, email_verified) VALUES ('sponsor-a@test.local', true) RETURNING id`,
    );
    const ownerB = await pool.query(
      `INSERT INTO users (email, email_verified) VALUES ('sponsor-b@test.local', true) RETURNING id`,
    );
    const ownerHidden = await pool.query(
      `INSERT INTO users (email, email_verified) VALUES ('sponsor-hidden@test.local', true) RETURNING id`,
    );

    const tierPrimary = await pool.query(
      `INSERT INTO sponsor_tiers (name, logo_priority) VALUES ('Primary', 1) RETURNING id`,
    );
    const tierStandard = await pool.query(
      `INSERT INTO sponsor_tiers (name, logo_priority) VALUES ('Standard', 2) RETURNING id`,
    );

    // Enterprises are revealed by their OWN visibility window (H45), not by
    // owning a published challenge.
    const entA = await pool.query(
      `INSERT INTO enterprises (name, logo_url, website, tier_id, visibility, available_from)
       VALUES ($1, $2, $3, $4, 'visible', now() - interval '1 hour') RETURNING id`,
      ["Acme", "https://cdn.test/acme.png", "https://acme.test", tierPrimary.rows[0].id],
    );
    const entB = await pool.query(
      `INSERT INTO enterprises (name, logo_url, website, tier_id, visibility, available_from)
       VALUES ($1, $2, $3, $4, 'visible', now() - interval '2 hours') RETURNING id`,
      ["Beta", "https://cdn.test/beta.png", "https://beta.test", tierStandard.rows[0].id],
    );
    const entHidden = await pool.query(
      `INSERT INTO enterprises (name, logo_url) VALUES ($1, $2) RETURNING id`,
      ["Hidden Corp", "https://cdn.test/hidden.png"],
    );
    // Visible with a future reveal trigger stays visible; the trigger only
    // flips hidden rows when it matures.
    await pool.query(
      `INSERT INTO enterprises (name, logo_url, visibility, available_from)
       VALUES ('Future Corp', 'https://cdn.test/future.png', 'visible', now() + interval '2 hours')`,
    );

    const sponsorA = await pool.query(
      `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
      [entA.rows[0].id, ownerA.rows[0].id],
    );
    const sponsorB = await pool.query(
      `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
      [entB.rows[0].id, ownerB.rows[0].id],
    );
    const sponsorHidden = await pool.query(
      `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
      [entHidden.rows[0].id, ownerHidden.rows[0].id],
    );

    await pool.query(
      `INSERT INTO challenges (author, title, description, criteria, prizes, visibility, available_from)
       VALUES
       ($1, 'AI Prize', 'Public challenge A', 'Demo + impact', '[{"name":"€1k"}]'::jsonb, 'visible', now() - interval '1 hour'),
       ($2, 'Cloud Prize', 'Public challenge B', 'Architecture', '[{"name":"Credits"}]'::jsonb, 'visible', now() - interval '2 hours'),
       ($3, 'Hidden Prize', 'Not public', 'N/A', '[]'::jsonb, 'hidden', now() - interval '1 hour'),
       ($1, 'Future Prize', 'Still public', 'N/A', '[]'::jsonb, 'visible', now() + interval '2 hours')`,
      [sponsorA.rows[0].id, sponsorB.rows[0].id, sponsorHidden.rows[0].id],
    );

    await pool.query(
      `INSERT INTO schedule (title, description, location, type, starts_at, ends_at, visibility, publish_at)
       VALUES
       ('Opening', 'Kickoff', 'Main Stage', 'ceremony', now() + interval '1 hour', now() + interval '2 hours', 'shown', now() - interval '1 hour'),
       ('Private Ops', 'Staff only', 'Backstage', 'other', now() + interval '3 hours', now() + interval '4 hours', 'hidden', now() - interval '1 hour'),
       ('Future Reveal', 'Will be published later', 'Hall B', 'workshop', now() + interval '5 hours', now() + interval '6 hours', 'shown', now() + interval '1 hour')`,
    );

    const server = await getApp();

    const challenges = await server.inject({ method: "GET", url: "/api/public/challenges" });
    expect(challenges.statusCode).toBe(200);
    expect(challenges.json().items).toHaveLength(3);
    expect(
      challenges
        .json()
        .items.map((c: { title: Record<string, string> }) => c.title.en)
        .sort(),
    ).toEqual(["AI Prize", "Cloud Prize", "Future Prize"]);
    expect(challenges.json().items[0].enterprise.name).toBeTruthy();

    const sponsors = await server.inject({ method: "GET", url: "/api/public/sponsors" });
    expect(sponsors.statusCode).toBe(200);
    expect(sponsors.json().items).toHaveLength(3);
    expect(sponsors.json().items.map((s: { name: string }) => s.name)).toEqual([
      "Acme",
      "Beta",
      "Future Corp",
    ]);
    expect(sponsors.json().items.map((s: { priority: number }) => s.priority)).toEqual([
      1, 2, 9999,
    ]);

    const activities = await server.inject({ method: "GET", url: "/api/public/activities" });
    expect(activities.statusCode).toBe(200);
    expect(activities.json().items).toHaveLength(1);
    expect(activities.json().items[0].title).toBe("Opening");
  });
});
