import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";
import {
  assignQueueGroupToRoom,
  createEnterpriseChallenges,
  createRepoWithTeam,
  createRoom,
  enqueueRepo,
  queueGroupOf,
} from "./fixtures.js";

/**
 * H46 step 3: the admin action that actually creates a shared judging queue.
 * Everything a merged group implies — group-scoped ordering, call-once,
 * expanded room sets — was built and tested by the room_queue_groups repoint;
 * what is under test here is the merge itself: who may run it, what it does to
 * positions, rooms and the judging form, and that it cannot be raced or
 * half-applied.
 */

let app: App;
let adminId: number;

beforeEach(async () => {
  await truncateAll();
  app = app ?? (await buildTestApp());
  adminId = await createUserWithCapabilities([
    CAPABILITIES.QUEUE_ADMIN,
    CAPABILITIES.QUEUE_OPERATE,
  ]);
});

afterAll(async () => {
  await app?.close();
});

function label(text: string) {
  return { en: text, es: text, gl: text };
}

const scale = (key: string, text: string) => ({
  key,
  kind: "scale" as const,
  label: label(text),
  required: false,
  min: 0,
  max: 10,
});

async function waitForBlockedQuery(fragment: string): Promise<void> {
  const { pool } = await import("../../src/db/pool.js");
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n
         FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query LIKE $1`,
      [`%${fragment}%`],
    );
    if (rows[0].n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for blocked query: ${fragment}`);
}

async function merge(
  enterpriseId: number,
  challengeIds: number[],
  displayName: string,
  userId: number = adminId,
) {
  return app.inject({
    method: "POST",
    url: `/api/enterprises/${enterpriseId}/queue-groups/merge`,
    headers: { ...asUser(userId), "idempotency-key": crypto.randomUUID() },
    payload: { challengeIds, displayName },
  });
}

describe("merging challenges into a shared queue", () => {
  it("puts every challenge in one group under the admin-chosen name", async () => {
    const { enterpriseId, challengeIds } = await createEnterpriseChallenges(3);
    const res = await merge(enterpriseId, challengeIds, "ACME's Challenges");
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.displayName).toBe("ACME's Challenges");
    expect(body.shared).toBe(true);
    expect(body.challenges.map((c: { id: number }) => c.id).sort()).toEqual(
      [...challengeIds].sort(),
    );

    // The unique on challenge_id means "one group per challenge, ever": the
    // absorbed groups are gone, not left behind empty.
    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM queue_groups WHERE enterprise_id = $1`,
      [enterpriseId],
    );
    expect(rows[0].n).toBe(1);
    for (const challengeId of challengeIds) {
      expect(await queueGroupOf(challengeId)).toBe(body.id);
    }
  });

  it("renumbers the merged queues into one ordering key space", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const { enterpriseId, challengeIds } = await createEnterpriseChallenges(2);
    const [first, second] = challengeIds as [number, number];

    // Each challenge numbered its own queue from 1 — positions collide.
    const a = await createRepoWithTeam();
    const b = await createRepoWithTeam();
    const c = await createRepoWithTeam();
    await enqueueRepo(first, a.repoId, 1);
    await enqueueRepo(first, b.repoId, 2);
    await enqueueRepo(second, c.repoId, 1);

    expect((await merge(enterpriseId, challengeIds, "Shared")).statusCode).toBe(201);

    const { rows } = await pool.query(
      `SELECT position FROM queue_entries
        WHERE challenge_id = ANY($1::int[]) ORDER BY position ASC`,
      [challengeIds],
    );
    expect(rows.map((r: { position: number }) => r.position)).toEqual([1, 2, 3]);
  });

  it("hands the absorbed queues' rooms to the merged one instead of unassigning them", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const { enterpriseId, challengeIds } = await createEnterpriseChallenges(2);
    const [first, second] = challengeIds as [number, number];
    const roomA = await createRoom();
    const roomB = await createRoom();
    await assignQueueGroupToRoom(roomA, await queueGroupOf(first));
    await assignQueueGroupToRoom(roomB, await queueGroupOf(second));

    const body = (await merge(enterpriseId, challengeIds, "Shared")).json();
    expect(body.rooms.map((r: { id: number }) => r.id).sort()).toEqual([roomA, roomB].sort());

    // The FK is ON DELETE CASCADE — a room left pointing at a dropped group
    // would have silently lost its assignment.
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM room_queue_groups WHERE room_id = ANY($1::int[])`,
      [[roomA, roomB]],
    );
    expect(rows[0].n).toBe(2);
  });

  it("refuses to span enterprises", async () => {
    const a = await createEnterpriseChallenges(1);
    const b = await createEnterpriseChallenges(1);
    const res = await merge(a.enterpriseId, [a.challengeIds[0]!, b.challengeIds[0]!], "Nope");
    expect(res.statusCode).toBe(400);
    // ...and the database would have refused it too.
    const { pool } = await import("../../src/db/pool.js");
    await expect(
      pool.query(`UPDATE queue_group_challenges SET queue_group_id = $1 WHERE challenge_id = $2`, [
        await queueGroupOf(a.challengeIds[0]!),
        b.challengeIds[0]!,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("still merges while teams are queued and being called", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const { enterpriseId, challengeIds } = await createEnterpriseChallenges(2);
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeIds[0]!, repoId, 1);
    await pool.query(`UPDATE queue_entries SET status = 'called' WHERE id = $1`, [entryId]);

    // A queue that exists, and is being called from, is still configurable —
    // organisers merge in the last minutes before the first team is judged.
    const res = await merge(enterpriseId, challengeIds, "Still in time");
    expect(res.statusCode).toBe(201);
    expect(await queueGroupOf(challengeIds[0]!)).toBe(await queueGroupOf(challengeIds[1]!));
  });

  it("refuses once a team has been evaluated", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const { enterpriseId, challengeIds } = await createEnterpriseChallenges(2);
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeIds[0]!, repoId, 1);
    await pool.query(
      `UPDATE queue_entries SET status = 'completed', completed_at = now() WHERE id = $1`,
      [entryId],
    );

    const res = await merge(enterpriseId, challengeIds, "Too late");
    expect(res.statusCode).toBe(409);
    // Nothing moved.
    expect(await queueGroupOf(challengeIds[0]!)).not.toBe(await queueGroupOf(challengeIds[1]!));
  });

  it("refuses to edit a merged form once a team has been evaluated", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const { enterpriseId, challengeIds } = await createEnterpriseChallenges(2, [
      [scale("innovation", "Innovation")],
      [scale("demo", "Demo quality")],
    ]);
    const groupId = (await merge(enterpriseId, challengeIds, "Shared")).json().id;

    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeIds[0]!, repoId, 1);
    await pool.query(
      `UPDATE queue_entries SET status = 'completed', completed_at = now() WHERE id = $1`,
      [entryId],
    );

    const criteria = await app.inject({
      method: "PATCH",
      url: `/api/queue/groups/${groupId}`,
      headers: asUser(adminId),
      payload: { criteria: [scale("innovation", "Innovation")] },
    });
    expect(criteria.statusCode).toBe(409);

    // Renaming stays available — a name cannot invalidate an answer.
    const rename = await app.inject({
      method: "PATCH",
      url: `/api/queue/groups/${groupId}`,
      headers: asUser(adminId),
      payload: { displayName: "Renamed late" },
    });
    expect(rename.statusCode).toBe(200);
  });

  it("needs at least two challenges", async () => {
    const { enterpriseId, challengeIds } = await createEnterpriseChallenges(2);
    const res = await merge(enterpriseId, [challengeIds[0]!], "Solo");
    expect(res.statusCode).toBe(400);
  });

  it("writes one audit row for the merge", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const { enterpriseId, challengeIds } = await createEnterpriseChallenges(2);
    await merge(enterpriseId, challengeIds, "Shared");
    const { rows } = await pool.query(
      `SELECT actor_id, entity_type, action FROM audit_log WHERE action = 'queue_group.merge'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_id: adminId, entity_type: "queue_group" });
  });
});

describe("the all-queues listing", () => {
  it("shows an admin every enterprise's queues, including ones no room serves", async () => {
    const alpha = await createEnterpriseChallenges(2);
    const beta = await createEnterpriseChallenges(1);
    await merge(alpha.enterpriseId, alpha.challengeIds, "ACME's Challenges");

    const res = await app.inject({
      method: "GET",
      url: "/api/queue/groups",
      headers: asUser(adminId),
    });
    const groups = res.json().groups as Array<{
      id: number;
      enterpriseId: number;
      displayName: string;
      shared: boolean;
      rooms: unknown[];
    }>;
    // The merge collapsed alpha's two queues into one; beta keeps its own.
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.enterpriseId === alpha.enterpriseId)).toMatchObject({
      displayName: "ACME's Challenges",
      shared: true,
    });
    expect(groups.find((g) => g.enterpriseId === beta.enterpriseId)?.shared).toBe(false);
    // A queue serving no room is still listed — it is only reachable here.
    expect(groups.every((g) => g.rooms.length === 0)).toBe(true);
  });

  it("scopes a sponsor rep to their own enterprise's queues", async () => {
    const alpha = await createEnterpriseChallenges(2);
    await createEnterpriseChallenges(1);

    const res = await app.inject({
      method: "GET",
      url: "/api/queue/groups",
      headers: asUser(alpha.repId),
    });
    const groups = res.json().groups as Array<{ enterpriseId: number }>;
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.enterpriseId === alpha.enterpriseId)).toBe(true);
  });

  it("shows nothing to someone who manages no enterprise", async () => {
    await createEnterpriseChallenges(2);
    const outsider = await createUser();
    const res = await app.inject({
      method: "GET",
      url: "/api/queue/groups",
      headers: asUser(outsider),
    });
    expect(res.json().groups).toEqual([]);
  });

  it("counts a team in two of a shared queue's challenges once", async () => {
    const { enterpriseId, challengeIds } = await createEnterpriseChallenges(2);
    const [first, second] = challengeIds as [number, number];
    const shared = await createRepoWithTeam();
    const other = await createRepoWithTeam();
    await enqueueRepo(first, shared.repoId, 1);
    await enqueueRepo(second, shared.repoId, 2);
    await enqueueRepo(first, other.repoId, 3);
    await merge(enterpriseId, challengeIds, "Shared");

    const res = await app.inject({
      method: "GET",
      url: "/api/queue/groups",
      headers: asUser(adminId),
    });
    // Three queue_entries rows, two teams — the same dedupe the queue itself
    // applies, so the admin's count matches what judges will be called.
    expect((res.json().groups as Array<{ teams: number }>)[0]!.teams).toBe(2);
  });

  it("names the rooms serving each queue", async () => {
    const { enterpriseId, challengeIds } = await createEnterpriseChallenges(2);
    const roomId = await createRoom({ name: "Sala A" });
    const body = (await merge(enterpriseId, challengeIds, "Shared")).json();
    await assignQueueGroupToRoom(roomId, body.id);

    const res = await app.inject({
      method: "GET",
      url: "/api/queue/groups",
      headers: asUser(adminId),
    });
    const groups = res.json().groups as Array<{ rooms: Array<{ name: string }> }>;
    expect(groups[0]!.rooms.map((room) => room.name)).toEqual(["Sala A"]);
  });
});

describe("reading a queue in order", () => {
  it("shows one line per team, furthest-through first, with its room", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const { enterpriseId, challengeIds } = await createEnterpriseChallenges(2);
    const [first, second] = challengeIds as [number, number];
    const roomId = await createRoom({ name: "Sala A" });

    const presenting = await createRepoWithTeam(undefined, "Team Presenting");
    const shared = await createRepoWithTeam(undefined, "Team Shared");
    const waiting = await createRepoWithTeam(undefined, "Team Waiting");
    const presentingEntry = await enqueueRepo(first, presenting.repoId, 1);
    await enqueueRepo(first, shared.repoId, 2);
    await enqueueRepo(second, shared.repoId, 5);
    await enqueueRepo(first, waiting.repoId, 3);

    const group = (await merge(enterpriseId, challengeIds, "Shared")).json();
    await assignQueueGroupToRoom(roomId, group.id);
    await pool.query(
      `UPDATE queue_entries SET status = 'presenting', assigned_room_id = $2 WHERE id = $1`,
      [presentingEntry, roomId],
    );

    const res = await app.inject({
      method: "GET",
      url: `/api/queue/groups/${group.id}/queue`,
      headers: asUser(adminId),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const entries = body.entries as Array<{
      repo_name: string;
      status: string;
      room_name: string | null;
    }>;

    // Three teams, not four rows — the team queued for both challenges is one
    // line, exactly as it is one call.
    expect(entries.map((e) => e.repo_name)).toEqual([
      "Team Presenting",
      "Team Shared",
      "Team Waiting",
    ]);
    expect(entries[0]).toMatchObject({ status: "presenting", room_name: "Sala A" });
    expect(entries[1]!.status).toBe("waiting");
    expect(body.challenges).toHaveLength(2);
  });

  it("reads a queue no room serves yet", async () => {
    const { challengeIds } = await createEnterpriseChallenges(1);
    const { repoId } = await createRepoWithTeam(undefined, "Team Orphan");
    await enqueueRepo(challengeIds[0]!, repoId, 1);

    const res = await app.inject({
      method: "GET",
      url: `/api/queue/groups/${await queueGroupOf(challengeIds[0]!)}/queue`,
      headers: asUser(adminId),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().entries.map((e: { repo_name: string }) => e.repo_name)).toEqual([
      "Team Orphan",
    ]);
  });

  it("refuses someone who manages neither the queue nor the platform", async () => {
    const { challengeIds } = await createEnterpriseChallenges(1);
    const outsider = await createUser();
    const res = await app.inject({
      method: "GET",
      url: `/api/queue/groups/${await queueGroupOf(challengeIds[0]!)}/queue`,
      headers: asUser(outsider),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("merge permissions", () => {
  it("lets the enterprise's own rep merge, and nobody else", async () => {
    const { enterpriseId, repId, challengeIds } = await createEnterpriseChallenges(2);
    const outsider = await createUser();

    expect((await merge(enterpriseId, challengeIds, "Nope", outsider)).statusCode).toBe(403);
    expect((await merge(enterpriseId, challengeIds, "Ours", repId)).statusCode).toBe(201);
  });

  it("does not let another enterprise's rep merge", async () => {
    const mine = await createEnterpriseChallenges(2);
    const theirs = await createEnterpriseChallenges(1);
    const res = await merge(mine.enterpriseId, mine.challengeIds, "Nope", theirs.repId);
    expect(res.statusCode).toBe(403);
  });
});

describe("judging-form merge", () => {
  it("folds duplicate questions together and keeps the rest", async () => {
    const { enterpriseId, challengeIds } = await createEnterpriseChallenges(2, [
      [scale("innovation", "Innovation"), scale("impact", "Impact")],
      // Same question, different casing/spacing/key — one merged question.
      [scale("innovacion", "  innovation "), scale("demo", "Demo quality")],
    ]);
    const res = await merge(enterpriseId, challengeIds, "Shared");
    const body = res.json();
    expect(body.criteria.map((q: { key: string }) => q.key)).toEqual([
      "innovation",
      "impact",
      "demo",
    ]);
    expect(body.mergedPanel.duplicatesDropped).toBe(1);
  });

  it("renames a key claimed by two different questions", async () => {
    const { enterpriseId, challengeIds } = await createEnterpriseChallenges(2, [
      [scale("nota", "Overall score")],
      [scale("nota", "Presentation quality")],
    ]);
    const preview = await app.inject({
      method: "POST",
      url: `/api/enterprises/${enterpriseId}/queue-groups/preview-merge`,
      headers: asUser(adminId),
      payload: { challengeIds },
    });
    expect(preview.json().renamedKeys).toEqual([{ from: "nota", to: "nota-2" }]);
    expect(preview.json().questions.map((q: { key: string }) => q.key)).toEqual(["nota", "nota-2"]);

    // Previewing writes nothing.
    expect(await queueGroupOf(challengeIds[0]!)).not.toBe(await queueGroupOf(challengeIds[1]!));
  });

  it("does not preview another enterprise's private judging criteria", async () => {
    const mine = await createEnterpriseChallenges(1, [[scale("mine", "Mine")]]);
    const foreign = await createEnterpriseChallenges(1, [
      [scale("foreign-secret", "Foreign private criterion")],
    ]);

    const preview = await app.inject({
      method: "POST",
      url: `/api/enterprises/${mine.enterpriseId}/queue-groups/preview-merge`,
      headers: asUser(mine.repId),
      payload: { challengeIds: [mine.challengeIds[0]!, foreign.challengeIds[0]!] },
    });

    expect(preview.statusCode).toBe(400);
    expect(preview.body).not.toContain("Foreign private criterion");
    expect(preview.body).not.toContain("foreign-secret");
  });

  it("scores every team in the group against the one merged form", async () => {
    const { upsertAttemptReview } = await import("../../src/modules/queue/judging.js");
    const { enterpriseId, challengeIds } = await createEnterpriseChallenges(2, [
      [scale("innovation", "Innovation")],
      [scale("demo", "Demo quality")],
    ]);
    await merge(enterpriseId, challengeIds, "Shared");

    // A team queued for the SECOND challenge can be scored on a question that
    // only ever belonged to the first — one form, not two.
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeIds[1]!, repoId, 1);
    const review = await upsertAttemptReview(entryId, adminId, { scores: { innovation: 7 } });
    expect(review.scores).toEqual({ innovation: 7 });
  });

  it("still validates a 1:1 group against its own challenge's form", async () => {
    const { upsertAttemptReview } = await import("../../src/modules/queue/judging.js");
    const { challengeIds } = await createEnterpriseChallenges(2, [
      [scale("innovation", "Innovation")],
      [scale("demo", "Demo quality")],
    ]);
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeIds[1]!, repoId, 1);
    await expect(
      upsertAttemptReview(entryId, adminId, { scores: { innovation: 7 } }),
    ).rejects.toThrow(/unknown question "innovation"/);
  });

  it("lets the admin edit the merged form and the name in review", async () => {
    const { enterpriseId, challengeIds } = await createEnterpriseChallenges(2, [
      [scale("innovation", "Innovation")],
      [scale("demo", "Demo quality")],
    ]);
    const groupId = (await merge(enterpriseId, challengeIds, "Draft name")).json().id;

    const res = await app.inject({
      method: "PATCH",
      url: `/api/queue/groups/${groupId}`,
      headers: asUser(adminId),
      payload: {
        displayName: "ACME's Challenges",
        criteria: [scale("innovation", "Innovation")],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().displayName).toBe("ACME's Challenges");
    expect(res.json().criteria.map((q: { key: string }) => q.key)).toEqual(["innovation"]);
  });

  it("refuses to give a 1:1 group a name or form of its own", async () => {
    const { challengeIds } = await createEnterpriseChallenges(1);
    const res = await app.inject({
      method: "PATCH",
      url: `/api/queue/groups/${await queueGroupOf(challengeIds[0]!)}`,
      headers: asUser(adminId),
      payload: { displayName: "Hand-picked" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("display name", () => {
  it("follows a renamed challenge while the group is 1:1, and stops once merged", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const { roomView } = await import("../../src/modules/queue/reads.js");
    const { enterpriseId, challengeIds } = await createEnterpriseChallenges(2);
    const [first] = challengeIds as [number, number];
    const roomId = await createRoom();
    await assignQueueGroupToRoom(roomId, await queueGroupOf(first));

    await pool.query(`UPDATE challenges SET title = 'Renamed' WHERE id = $1`, [first]);
    expect((await roomView(roomId)).challenge?.title).toBe("Renamed");

    await merge(enterpriseId, challengeIds, "ACME's Challenges");
    expect((await roomView(roomId)).challenge?.title).toBe("ACME's Challenges");

    // An admin-chosen shared name is never overwritten by a challenge rename.
    await pool.query(`UPDATE challenges SET title = 'Renamed again' WHERE id = $1`, [first]);
    expect((await roomView(roomId)).challenge?.title).toBe("ACME's Challenges");
  });

  it("labels a participant's queue with the shared name", async () => {
    const { myQueueStatus } = await import("../../src/modules/queue/reads.js");
    const { enterpriseId, challengeIds } = await createEnterpriseChallenges(2);
    const userId = await createUser();
    const { repoId } = await createRepoWithTeam([userId]);
    await enqueueRepo(challengeIds[0]!, repoId, 1);

    await merge(enterpriseId, challengeIds, "ACME's Challenges");
    expect((await myQueueStatus(userId))[0]!.challengeTitle).toBe("ACME's Challenges");
  });
});

describe("splitting back apart", () => {
  it("gives every challenge its own queue and form again", async () => {
    const { enterpriseId, challengeIds } = await createEnterpriseChallenges(2, [
      [scale("innovation", "Innovation")],
      [scale("demo", "Demo quality")],
    ]);
    const groupId = (await merge(enterpriseId, challengeIds, "Shared")).json().id;

    const res = await app.inject({
      method: "POST",
      url: `/api/enterprises/${enterpriseId}/queue-groups/${groupId}/split`,
      headers: { ...asUser(adminId), "idempotency-key": crypto.randomUUID() },
    });
    expect(res.statusCode).toBe(200);
    const groups = res.json().groups;
    expect(groups).toHaveLength(2);
    expect(groups.every((g: { shared: boolean }) => !g.shared)).toBe(true);
    expect(groups.every((g: { criteria: unknown }) => g.criteria === null)).toBe(true);
    expect(await queueGroupOf(challengeIds[0]!)).not.toBe(await queueGroupOf(challengeIds[1]!));
  });

  it("refuses to split a queue that is not shared", async () => {
    const { enterpriseId, challengeIds } = await createEnterpriseChallenges(1);
    const res = await app.inject({
      method: "POST",
      url: `/api/enterprises/${enterpriseId}/queue-groups/${await queueGroupOf(challengeIds[0]!)}/split`,
      headers: { ...asUser(adminId), "idempotency-key": crypto.randomUUID() },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("concurrency and idempotency", () => {
  it("serialises a form edit behind the first submitted evaluation", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const { upsertAttemptReview } = await import("../../src/modules/queue/judging.js");
    const { updateQueueGroup } = await import("../../src/modules/queue/group-merge.js");
    const { enterpriseId, challengeIds } = await createEnterpriseChallenges(2, [
      [scale("innovation", "Innovation")],
      [scale("demo", "Demo quality")],
    ]);
    const groupId = (await merge(enterpriseId, challengeIds, "Shared")).json().id;
    const { repoId } = await createRepoWithTeam();
    const entryId = await enqueueRepo(challengeIds[0]!, repoId, 1);

    // Hold the entry so submission can take the queue-group lock and pause.
    // A concurrent form edit must then wait for that group lock, observe the
    // committed submission, and fail instead of replacing its score keys.
    const blocker = await pool.connect();
    await blocker.query("BEGIN");
    await blocker.query(`SELECT id FROM queue_entries WHERE id = $1 FOR UPDATE`, [entryId]);

    const submitting = upsertAttemptReview(entryId, adminId, {
      scores: { innovation: 8, demo: 7 },
      submit: true,
    });
    let editing: ReturnType<typeof updateQueueGroup> | undefined;
    let synchronizationComplete = false;
    try {
      await waitForBlockedQuery("SELECT qe.id, qe.challenge_id, qe.status");
      editing = updateQueueGroup({
        queueGroupId: groupId,
        criteria: [scale("replacement", "Replacement")],
        actorId: adminId,
      });
      await waitForBlockedQuery("SELECT id FROM queue_groups WHERE id");
      synchronizationComplete = true;
    } finally {
      try {
        await blocker.query("ROLLBACK");
      } finally {
        blocker.release();
      }
      // A failed observation must not leave an in-flight database operation
      // behind to race this file's next beforeEach TRUNCATE.
      if (!synchronizationComplete) {
        await Promise.allSettled([submitting, ...(editing ? [editing] : [])]);
      }
    }

    expect((await submitting).status).toBe("submitted");
    if (!editing) throw new Error("Expected the concurrent queue-group edit");
    await expect(editing).rejects.toThrow(/form is locked/i);

    const { rows } = await pool.query(
      `SELECT judging_panel_criteria FROM queue_groups WHERE id = $1`,
      [groupId],
    );
    expect(rows[0].judging_panel_criteria.map((q: { key: string }) => q.key)).toEqual([
      "innovation",
      "demo",
    ]);
  });

  it("survives two admins merging the same challenges at once", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const { enterpriseId, challengeIds } = await createEnterpriseChallenges(3);

    const [a, b] = await Promise.all([
      merge(enterpriseId, challengeIds, "First"),
      merge(enterpriseId, challengeIds, "Second"),
    ]);
    // Whichever order they serialise in, both describe the same single group.
    expect([a.statusCode, b.statusCode]).toEqual([201, 201]);
    expect(a.json().id).toBe(b.json().id);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM queue_groups WHERE enterprise_id = $1`,
      [enterpriseId],
    );
    expect(rows[0].n).toBe(1);
    const { rows: memberships } = await pool.query(
      `SELECT count(*)::int AS n FROM queue_group_challenges WHERE challenge_id = ANY($1::int[])`,
      [challengeIds],
    );
    expect(memberships[0].n).toBe(3);
  });

  it("serialises two different merges of one enterprise without losing a challenge", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const { enterpriseId, challengeIds } = await createEnterpriseChallenges(4);
    const [c1, c2, c3, c4] = challengeIds as [number, number, number, number];

    await Promise.all([
      merge(enterpriseId, [c1, c2], "Left"),
      merge(enterpriseId, [c3, c4], "Right"),
    ]);

    // Two disjoint groups, every challenge still in exactly one of them.
    const { rows } = await pool.query(
      `SELECT queue_group_id, count(*)::int AS n
         FROM queue_group_challenges WHERE challenge_id = ANY($1::int[])
        GROUP BY queue_group_id ORDER BY n`,
      [challengeIds],
    );
    expect(rows.map((r: { n: number }) => r.n)).toEqual([2, 2]);
  });

  it("replays a repeated merge from the idempotency cache", async () => {
    const { enterpriseId, challengeIds } = await createEnterpriseChallenges(2);
    const key = crypto.randomUUID();
    const send = () =>
      app.inject({
        method: "POST",
        url: `/api/enterprises/${enterpriseId}/queue-groups/merge`,
        headers: { ...asUser(adminId), "idempotency-key": key },
        payload: { challengeIds, displayName: "Shared" },
      });
    const first = await send();
    const second = await send();
    expect(second.statusCode).toBe(first.statusCode);
    expect(second.json()).toEqual(first.json());

    const { pool } = await import("../../src/db/pool.js");
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'queue_group.merge'`,
    );
    expect(rows[0].n).toBe(1);
  });

  it("never lets call_next see two line items for a team merged mid-queue", async () => {
    const { callNextForRoom } = await import("../../src/modules/queue/service.js");
    const { pool } = await import("../../src/db/pool.js");
    const { enterpriseId, challengeIds } = await createEnterpriseChallenges(2);
    const [first, second] = challengeIds as [number, number];
    const roomId = await createRoom({ maxInWaitingArea: 5 });

    const shared = await createRepoWithTeam();
    await enqueueRepo(first, shared.repoId, 1);
    await enqueueRepo(second, shared.repoId, 1);

    const body = (await merge(enterpriseId, challengeIds, "Shared")).json();
    await assignQueueGroupToRoom(roomId, body.id);

    expect((await callNextForRoom(adminId, roomId))?.repo_id).toBe(shared.repoId);
    // The team's other entry is not a second call.
    expect(await callNextForRoom(adminId, roomId)).toBeNull();
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM queue_entries WHERE repo_id = $1 AND status = 'called'`,
      [shared.repoId],
    );
    expect(rows[0].n).toBe(1);
  });
});
