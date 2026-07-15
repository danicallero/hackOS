import "./env.js";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "../../src/db/pool.js";
import { drainOutboxOnce } from "../../src/modules/notifications/dispatcher.js";
import { notify } from "../../src/modules/notifications/service.js";
import { createUser } from "../helpers.js";
import {
  assignChallengeToRoom,
  createChallenge,
  createRepoWithTeam,
  createRoom,
} from "../queue/fixtures.js";
import {
  enqueueOutbox,
  getOutboxRow,
  makeDueNow,
  resetNotificationsState,
} from "./notif-helpers.js";

/**
 * Outbox dispatcher mechanics (H52, plan/07 §5.4): preference expansion,
 * mandatory queue category, exponential backoff, permanent-failure parking,
 * and the FOR UPDATE SKIP LOCKED no-double-send guarantee.
 */

beforeEach(async () => {
  await resetNotificationsState();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

async function addPushToken(userId: number, token: string): Promise<void> {
  await pool.query(`INSERT INTO push_tokens (user_id, token) VALUES ($1, $2)`, [userId, token]);
}

describe("notify() preference expansion (H51)", () => {
  it("skips channels the user disabled; no row means enabled", async () => {
    const userId = await createUser();
    await pool.query(
      `INSERT INTO notification_preferences (user_id, category, channel, enabled)
       VALUES ($1, 'announcements', 'email', false)`,
      [userId],
    );

    const ids = await notify(pool, {
      userId,
      category: "announcements",
      payload: { template: "generic", subject: "s", body: "b" },
    });

    const { rows } = await pool.query(
      `SELECT channel FROM notification_outbox WHERE user_id = $1 ORDER BY channel`,
      [userId],
    );
    expect(ids).toHaveLength(2);
    expect(rows.map((r) => r.channel)).toEqual(["in_app", "push"]);
  });

  it("category 'queue' is mandatory: delivered even when every channel is disabled (H51)", async () => {
    const userId = await createUser();
    for (const channel of ["in_app", "email", "push"]) {
      await pool.query(
        `INSERT INTO notification_preferences (user_id, category, channel, enabled)
         VALUES ($1, 'queue', $2, false)`,
        [userId, channel],
      );
    }

    await notify(pool, {
      userId,
      category: "queue",
      payload: { template: "queue.called", vars: { roomName: "A" } },
    });

    const { rows } = await pool.query(
      `SELECT channel FROM notification_outbox WHERE user_id = $1`,
      [userId],
    );
    expect(rows.map((r) => r.channel).sort()).toEqual(["email", "in_app", "push"]);
  });
});

describe("drainOutboxOnce", () => {
  it("marks in_app rows sent immediately — the row is the inbox item", async () => {
    const userId = await createUser();
    const id = await enqueueOutbox(userId, "in_app", { subject: "hello", body: "world" });

    const result = await drainOutboxOnce();

    expect(result.sent).toBe(1);
    const row = await getOutboxRow(id);
    expect(row.status).toBe("sent");
    expect(row.sent_at).not.toBeNull();
    expect(row.read_at).toBeNull();
  });

  it("applies exponential backoff on failure and stores last_error (H52)", async () => {
    const userId = await createUser();
    await addPushToken(userId, "ExponentToken[1]");
    const id = await enqueueOutbox(userId, "push", { subject: "x", body: "y" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("boom", { status: 500 })),
    );

    await drainOutboxOnce();
    const afterFirst = await getOutboxRow(id);
    expect(afterFirst.status).toBe("queued");
    expect(afterFirst.attempts).toBe(1);
    expect(afterFirst.last_error).toContain("500");
    const firstDelayMs = afterFirst.next_attempt_at.getTime() - Date.now();
    expect(firstDelayMs).toBeGreaterThan(20_000); // ~30s

    // Not due yet: a second drain must not claim it.
    const idle = await drainOutboxOnce();
    expect(idle.claimed).toBe(0);

    await makeDueNow(id);
    await drainOutboxOnce();
    const afterSecond = await getOutboxRow(id);
    expect(afterSecond.status).toBe("queued");
    expect(afterSecond.attempts).toBe(2);
    const secondDelayMs = afterSecond.next_attempt_at.getTime() - Date.now();
    expect(secondDelayMs).toBeGreaterThan(firstDelayMs); // exponential growth (~60s)
  });

  it("parks the row as failed after the attempt cap — never silently dropped", async () => {
    const userId = await createUser();
    await addPushToken(userId, "CapToken[1]");
    const id = await enqueueOutbox(userId, "push", { subject: "x", body: "y" });
    await pool.query(`UPDATE notification_outbox SET attempts = 7 WHERE id = $1`, [id]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("still down", { status: 503 })),
    );

    const result = await drainOutboxOnce();
    expect(result.parked).toBe(1);

    const row = await getOutboxRow(id);
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(8);
    expect(row.last_error).toContain("503");
    // parked, not deleted
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM notification_outbox`);
    expect(rows[0].n).toBe(1);
  });

  it("discord rows park immediately as 'channel not configured' (post-MVP no-op)", async () => {
    const userId = await createUser();
    const [id] = await notify(pool, {
      userId,
      category: "announcements",
      channels: ["discord"],
      payload: { subject: "x", body: "y" },
    });

    const result = await drainOutboxOnce();
    expect(result.parked).toBe(1);

    const row = await getOutboxRow(id as number);
    expect(row.status).toBe("failed");
    expect(row.last_error).toBe("channel not configured");
    expect(row.attempts).toBe(1);
  });

  it("two concurrent drains never double-send (FOR UPDATE SKIP LOCKED)", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      const userId = await createUser();
      await addPushToken(userId, `ConcToken[${i}]`);
      ids.push(await enqueueOutbox(userId, "push", { subject: `n${i}`, body: "b" }));
    }

    // Slow fetch keeps the first transaction's locks held while the second drain claims.
    const fetchMock = vi.fn(async (_url: unknown, init?: { body?: string }) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      const messages = JSON.parse(init?.body ?? "[]") as { to: string }[];
      return new Response(JSON.stringify({ data: messages.map(() => ({ status: "ok" })) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const [a, b] = await Promise.all([drainOutboxOnce(5), drainOutboxOnce(5)]);

    expect(a.claimed + b.claimed).toBe(10);
    expect(a.sent + b.sent).toBe(10);
    // one Expo call per outbox row — 10 total, no row dispatched twice
    expect(fetchMock).toHaveBeenCalledTimes(10);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM notification_outbox WHERE status = 'sent'`,
    );
    expect(rows[0].n).toBe(10);
  });

  it("parks a queue.called push as superseded once the entry has moved on (H51, H52)", async () => {
    const userId = await createUser();
    await addPushToken(userId, "StaleToken[1]");
    const challengeId = await createChallenge();
    const roomId = await createRoom();
    await assignChallengeToRoom(roomId, challengeId);
    const { repoId } = await createRepoWithTeam();
    const { rows: entryRows } = await pool.query(
      `INSERT INTO queue_entries (challenge_id, repo_id, status, position, assigned_room_id)
       VALUES ($1, $2, 'waiting', 0, NULL) RETURNING id`,
      [challengeId, repoId],
    );
    const entryId = entryRows[0].id;
    // Entry was called to roomId when the push was first queued...
    await pool.query(
      `UPDATE queue_entries SET status = 'called', assigned_room_id = $1 WHERE id = $2`,
      [roomId, entryId],
    );
    const id = await enqueueOutbox(
      userId,
      "push",
      { entryId, roomId, template: "queue.called", vars: { roomName: "A" } },
      "queue",
    );
    // ...but by the time the push is dispatched the team already requeued —
    // the delayed "you were called" would now be stale/duplicate-feeling.
    await pool.query(
      `UPDATE queue_entries SET status = 'waiting', assigned_room_id = NULL WHERE id = $1`,
      [entryId],
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("should never call Expo for a superseded row");
      }),
    );

    const result = await drainOutboxOnce();
    expect(result.superseded).toBe(1);
    expect(result.sent).toBe(0);

    const row = await getOutboxRow(id);
    expect(row.status).toBe("superseded");
  });

  it("raw INSERT compatibility: sibling-style rows without notify() are dispatched", async () => {
    const userId = await createUser();
    const id = await enqueueOutbox(
      userId,
      "in_app",
      { template: "generic", subject: "raw" },
      "queue",
    );
    const result = await drainOutboxOnce();
    expect(result.sent).toBe(1);
    expect((await getOutboxRow(id)).status).toBe("sent");
  });
});
