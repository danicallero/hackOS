import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { asUser, buildTestApp, createUser, truncateAll } from "../helpers.js";
import { admitParticipant, createChallenge } from "../projects/fixtures.js";

describe("planned work groups (#852)", () => {
  let app: App;
  beforeAll(async () => {
    app = await buildTestApp();
  });
  beforeEach(truncateAll);
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
      { id: challengeId, title: "Planning challenge" },
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
});
