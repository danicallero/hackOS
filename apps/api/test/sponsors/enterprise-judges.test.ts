import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";

/**
 * The judge roster is enterprise-scoped (`enterprise_judges`): whoever is on
 * it judges every challenge that enterprise authors and every room currently
 * serving one, replacing the room-scoped `room_judges` grant.
 */

let app: App;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

async function getApp(): Promise<App> {
  if (!app) app = await buildTestApp();
  return app;
}

/** Enterprise + a rep + a challenge authored by that rep's sponsor row. */
async function createEnterpriseWithChallenge(name: string) {
  const enterprise = await pool.query(`INSERT INTO enterprises (name) VALUES ($1) RETURNING id`, [
    name,
  ]);
  const rep = await createUser();
  const sponsor = await pool.query(
    `INSERT INTO sponsors (enterprise_id, user_id) VALUES ($1, $2) RETURNING id`,
    [enterprise.rows[0].id, rep],
  );
  const challenge = await pool.query(
    `INSERT INTO challenges (author, title) VALUES ($1, $2) RETURNING id`,
    [sponsor.rows[0].id, `${name} challenge`],
  );
  return {
    enterpriseId: Number(enterprise.rows[0].id),
    rep,
    challengeId: Number(challenge.rows[0].id),
  };
}

describe("enterprise judge roster", () => {
  it("lets an owning rep add, list and remove a judge, and audits both mutations", async () => {
    const a = await getApp();
    const { enterpriseId, rep } = await createEnterpriseWithChallenge("RosterCo");
    const judge = await createUser();

    const added = await a.inject({
      method: "POST",
      url: `/api/enterprises/${enterpriseId}/judges`,
      headers: asUser(rep),
      payload: { userId: judge },
    });
    expect(added.statusCode).toBe(201);
    expect(added.json().userId).toBe(judge);

    const listed = await a.inject({
      method: "GET",
      url: `/api/enterprises/${enterpriseId}/judges`,
      headers: asUser(rep),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().judges.map((j: { userId: number }) => j.userId)).toEqual([judge]);

    const removed = await a.inject({
      method: "DELETE",
      url: `/api/enterprises/${enterpriseId}/judges/${judge}`,
      headers: asUser(rep),
    });
    expect(removed.statusCode).toBe(200);
    expect(
      (await pool.query(`SELECT 1 FROM enterprise_judges WHERE enterprise_id = $1`, [enterpriseId]))
        .rowCount,
    ).toBe(0);

    const audits = await pool.query(
      `SELECT action, actor_id FROM audit_log
        WHERE entity_type = 'enterprise' AND action IN ('judge_added', 'judge_removed')
        ORDER BY id ASC`,
    );
    expect(audits.rows).toMatchObject([
      { action: "judge_added", actor_id: rep },
      { action: "judge_removed", actor_id: rep },
    ]);
  });

  it("refuses a rep of another enterprise, an unrelated account and its own judges", async () => {
    const a = await getApp();
    const { enterpriseId } = await createEnterpriseWithChallenge("MineCo");
    const { rep: foreignRep } = await createEnterpriseWithChallenge("TheirCo");
    const outsider = await createUser();
    const judge = await createUser();

    const admin = await createUserWithCapabilities([CAPABILITIES.QUEUE_ADMIN]);
    await a.inject({
      method: "POST",
      url: `/api/enterprises/${enterpriseId}/judges`,
      headers: asUser(admin),
      payload: { userId: judge },
    });

    for (const actor of [foreignRep, outsider, judge]) {
      const res = await a.inject({
        method: "POST",
        url: `/api/enterprises/${enterpriseId}/judges`,
        headers: asUser(actor),
        payload: { userId: outsider },
      });
      expect(res.statusCode).toBe(403);
      const read = await a.inject({
        method: "GET",
        url: `/api/enterprises/${enterpriseId}/judges`,
        headers: asUser(actor),
      });
      expect(read.statusCode).toBe(403);
    }

    const anonymous = await a.inject({
      method: "GET",
      url: `/api/enterprises/${enterpriseId}/judges`,
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it("rejects a duplicate add, an unknown user and an unknown enterprise", async () => {
    const a = await getApp();
    const { enterpriseId, rep } = await createEnterpriseWithChallenge("DupCo");
    const judge = await createUser();

    const first = await a.inject({
      method: "POST",
      url: `/api/enterprises/${enterpriseId}/judges`,
      headers: asUser(rep),
      payload: { userId: judge },
    });
    expect(first.statusCode).toBe(201);

    const again = await a.inject({
      method: "POST",
      url: `/api/enterprises/${enterpriseId}/judges`,
      headers: asUser(rep),
      payload: { userId: judge },
    });
    expect(again.statusCode).toBe(409);

    const unknownUser = await a.inject({
      method: "POST",
      url: `/api/enterprises/${enterpriseId}/judges`,
      headers: asUser(rep),
      payload: { userId: 9_999_999 },
    });
    expect(unknownUser.statusCode).toBe(404);

    const admin = await createUserWithCapabilities([CAPABILITIES.QUEUE_ADMIN]);
    const unknownEnterprise = await a.inject({
      method: "GET",
      url: "/api/enterprises/9999999/judges",
      headers: asUser(admin),
    });
    expect(unknownEnterprise.statusCode).toBe(404);

    const notAJudge = await a.inject({
      method: "DELETE",
      url: `/api/enterprises/${enterpriseId}/judges/${rep}`,
      headers: asUser(rep),
    });
    expect(notAJudge.statusCode).toBe(404);
  });

  it("offers every account as a candidate, not just the enterprise's own reps", async () => {
    const a = await getApp();
    const { enterpriseId, rep } = await createEnterpriseWithChallenge("OutsideCo");
    const outsider = await createUser();

    const res = await a.inject({
      method: "GET",
      url: `/api/enterprises/${enterpriseId}/judge-candidates`,
      headers: asUser(rep),
    });
    expect(res.statusCode).toBe(200);
    const ids = res.json().users.map((u: { id: number }) => u.id);
    expect(ids).toContain(outsider);
    expect(ids).toContain(rep);
  });

  it("grants challenge and room access on add, and revokes it on removal", async () => {
    const a = await getApp();
    const { enterpriseId, rep, challengeId } = await createEnterpriseWithChallenge("AccessCo");
    const judge = await createUser();
    const room = await pool.query(
      `INSERT INTO rooms (name, slug) VALUES ('Sala roster', 'sala-roster') RETURNING id`,
    );
    const roomId = Number(room.rows[0].id);
    await pool.query(
      `INSERT INTO room_queue_groups (room_id, queue_group_id)
       SELECT $1, queue_group_id FROM queue_group_challenges WHERE challenge_id = $2`,
      [roomId, challengeId],
    );
    await pool.query(`INSERT INTO room_queue_state (room_id, is_paused) VALUES ($1, true)`, [
      roomId,
    ]);

    const roomView = () =>
      a.inject({ method: "GET", url: `/api/queue/rooms/${roomId}/view`, headers: asUser(judge) });
    const visibleChallenges = () =>
      a.inject({ method: "GET", url: "/api/challenges", headers: asUser(judge) });

    expect((await roomView()).statusCode).toBe(403);
    expect((await visibleChallenges()).statusCode).toBe(403);

    await a.inject({
      method: "POST",
      url: `/api/enterprises/${enterpriseId}/judges`,
      headers: asUser(rep),
      payload: { userId: judge },
    });

    expect((await roomView()).statusCode).toBe(200);
    const assigned = await visibleChallenges();
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().challenges.map((c: { id: number }) => c.id)).toContain(challengeId);
    const me = await a.inject({ method: "GET", url: "/api/me", headers: asUser(judge) });
    expect(me.json().isEnterpriseJudge).toBe(true);
    expect(me.json().role).toBe("judge");

    await a.inject({
      method: "DELETE",
      url: `/api/enterprises/${enterpriseId}/judges/${judge}`,
      headers: asUser(rep),
    });

    expect((await roomView()).statusCode).toBe(403);
    expect((await visibleChallenges()).statusCode).toBe(403);
    const afterRemoval = await a.inject({
      method: "GET",
      url: "/api/me",
      headers: asUser(judge),
    });
    expect(afterRemoval.json().isEnterpriseJudge).toBe(false);
  });
});
