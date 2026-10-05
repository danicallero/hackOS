import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";
import { admitParticipant, createChallenge } from "../projects/fixtures.js";

describe("planned work groups (#852)", () => {
  let app: App;
  beforeAll(async () => {
    app = await buildTestApp();
  });
  beforeEach(async () => {
    await truncateAll();
    await pool.query(`UPDATE queue_settings SET schedule_start_at = NULL WHERE id = 1`);
    await pool.query(
      `INSERT INTO event_config (id,participants_can_create_projects) VALUES (1,true) ON CONFLICT (id) DO UPDATE SET participants_can_create_projects=true`,
    );
  });
  afterAll(async () => {
    await app.close();
  });

  it("keeps invitation acceptance and challenge intent separate from queues", async () => {
    const owner = await createUser({ email: "owner@work-group.test" });
    const invitee = await createUser({ email: "invitee@work-group.test" });
    await admitParticipant(owner);
    await admitParticipant(invitee);
    const challengeId = await createChallenge("Planning challenge", []);
    const created = await app.inject({
      method: "POST",
      url: "/api/me/work-groups",
      headers: { ...asUser(owner), "idempotency-key": "group-create" },
      payload: { name: "Planners" },
    });
    expect(created.statusCode).toBe(200);
    const groupId = created.json().id;
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/me/work-groups/${groupId}/invites`,
          headers: { ...asUser(owner), "idempotency-key": "invite" },
          payload: { email: "invitee@work-group.test" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/me/work-groups/${groupId}/invites/accept`,
          headers: { ...asUser(invitee), "idempotency-key": "accept" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/me/work-groups/${groupId}/challenges`,
          headers: { ...asUser(owner), "idempotency-key": "intent" },
          payload: { challengeId },
        })
      ).statusCode,
    ).toBe(200);
    const mine = await app.inject({
      method: "GET",
      url: "/api/me/work-groups",
      headers: asUser(invitee),
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().groups[0].members).toHaveLength(2);
    expect(mine.json().groups[0].challenges).toEqual([
      { id: challengeId, title: "Planning challenge", mandatory: false },
    ]);
    const queues = await app.inject({
      method: "GET",
      url: "/api/me/projects",
      headers: asUser(owner),
    });
    expect(queues.json().projects).toEqual([]);
  });

  it("keeps project-like planning edits and deletion transactional (#852, #854)", async () => {
    const owner = await createUser({ email: "detail-owner@work-group.test" });
    const invitee = await createUser({ email: "detail-invitee@work-group.test" });
    await admitParticipant(owner);
    await admitParticipant(invitee);
    const created = await app.inject({
      method: "POST",
      url: "/api/me/work-groups",
      headers: { ...asUser(owner), "idempotency-key": "detail-create" },
      payload: { name: "Before import" },
    });
    const id = created.json().id;
    const edited = await app.inject({
      method: "PATCH",
      url: `/api/me/work-groups/${id}`,
      headers: asUser(owner),
      payload: {
        description: "Planning only",
        githubUrl: "https://github.com/example/team",
        demoUrl: "https://demo.example/team",
        devpostUrl: "https://example.devpost.com/software/team",
        presentationTimingPreference: "early",
      },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({
      description: "Planning only",
      presentation_timing_preference: "early",
    });
    await app.inject({
      method: "POST",
      url: `/api/me/work-groups/${id}/invites`,
      headers: { ...asUser(owner), "idempotency-key": "detail-invite" },
      payload: { email: "detail-invitee@work-group.test" },
    });
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/me/work-groups/${id}/members/${invitee}`,
          headers: { ...asUser(owner), "idempotency-key": "detail-remove" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/me/work-groups/${id}`,
          headers: { ...asUser(owner), "idempotency-key": "detail-delete" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/me/work-groups/${id}`,
          headers: asUser(owner),
        })
      ).statusCode,
    ).toBe(404);
  });
  it("includes mandatory intent without queue entries and counts a linked project once", async () => {
    const owner = await createUser();
    await admitParticipant(owner);
    const challengeId = await createChallenge("Required", []);
    await pool.query(`UPDATE challenges SET mandatory=true WHERE id=$1`, [challengeId]);
    const created = await app.inject({
      method: "POST",
      url: "/api/me/work-groups",
      headers: { ...asUser(owner), "idempotency-key": "mandatory-group" },
      payload: { name: "Team" },
    });
    expect(created.statusCode).toBe(200);
    const id = created.json().id;
    const detail = await app.inject({
      method: "GET",
      url: `/api/me/work-groups/${id}`,
      headers: asUser(owner),
    });
    expect(detail.json().challenges).toEqual([
      { id: challengeId, title: "Required", mandatory: true },
    ]);
    const removed = await app.inject({
      method: "DELETE",
      url: `/api/me/work-groups/${id}/challenges/${challengeId}`,
      headers: { ...asUser(owner), "idempotency-key": "mandatory-withdraw" },
    });
    expect(removed.statusCode).toBe(409);
    expect((await pool.query(`SELECT * FROM queue_entries`)).rowCount).toBe(0);
    const reader = await createUserWithCapabilities([CAPABILITIES.PROJECTS_READ]);
    const before = await app.inject({
      method: "GET",
      url: "/api/work-groups/estimates",
      headers: asUser(reader),
    });
    expect(before.json().estimates[0]).toMatchObject({
      groupCount: 1,
      expectedCount: 1,
      projectCount: 0,
      participantCount: 1,
    });
    const repo = await pool.query(
      `INSERT INTO repos(name,description) VALUES ('Imported','From Devpost') RETURNING id`,
    );
    await pool.query(`UPDATE planned_work_groups SET linked_repo_id=$2 WHERE id=$1`, [
      id,
      repo.rows[0].id,
    ]);
    await pool.query(`INSERT INTO submissions(repo_id,user_id) VALUES($1,$2)`, [
      repo.rows[0].id,
      owner,
    ]);
    await pool.query(
      `INSERT INTO queue_entries(repo_id,challenge_id,status,position) VALUES($1,$2,'waiting',1)`,
      [repo.rows[0].id, challengeId],
    );
    const after = await app.inject({
      method: "GET",
      url: "/api/work-groups/estimates",
      headers: asUser(reader),
    });
    expect(after.json().estimates[0]).toMatchObject({
      groupCount: 1,
      expectedCount: 1,
      projectCount: 1,
    });
    const edited = await app.inject({
      method: "PATCH",
      url: `/api/me/work-groups/${id}`,
      headers: asUser(owner),
      payload: { name: "Updated", presentationTimingPreference: "no_preference" },
    });
    expect(edited.statusCode).toBe(200);
    expect(
      (await pool.query(`SELECT name,description FROM repos WHERE id=$1`, [repo.rows[0].id]))
        .rows[0],
    ).toEqual({ name: "Updated", description: "From Devpost" });
    const timing = await app.inject({
      method: "PATCH",
      url: `/api/me/work-groups/${id}`,
      headers: asUser(owner),
      payload: { presentationTimingPreference: "early" },
    });
    expect(timing.statusCode).toBe(409);
  });
});
