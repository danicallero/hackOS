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
});
