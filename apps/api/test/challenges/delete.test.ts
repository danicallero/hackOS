import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { asUser, createUser, createUserWithCapabilities, useTestApp } from "../helpers.js";
import { createEntrant, createOwnedChallenge, groupOf } from "./fixtures.js";

/** H44: permanent challenge delete — blocked, not cascaded, the moment anything real is attached. */

const getApp = useTestApp();

async function seedRoom(name: string): Promise<number> {
  const { rows } = await pool.query(`INSERT INTO rooms (name) VALUES ($1) RETURNING id`, [name]);
  return Number(rows[0].id);
}

describe("challenge delete (H44)", () => {
  it("deletes an unused challenge and audits it", async () => {
    const server = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
    const challengeId = await createOwnedChallenge(await createUser(), "Deletable Challenge");

    const res = await server.inject({
      method: "DELETE",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(admin),
    });
    expect(res.statusCode).toBe(204);

    const { rows } = await pool.query(`SELECT 1 FROM challenges WHERE id = $1`, [challengeId]);
    expect(rows).toHaveLength(0);

    const audit = await pool.query(
      `SELECT action FROM audit_log WHERE entity_type = 'challenge' AND entity_id = $1`,
      [challengeId],
    );
    expect(audit.rows.map((r) => r.action)).toContain("deleted");
  });

  it("blocks delete when the challenge has queue entries", async () => {
    const server = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
    const challengeId = await createOwnedChallenge(await createUser(), "Deletable Challenge");
    await createEntrant(challengeId, "Entrant Team");

    const res = await server.inject({
      method: "DELETE",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(admin),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.hasQueueEntries).toBe(true);

    const { rows } = await pool.query(`SELECT 1 FROM challenges WHERE id = $1`, [challengeId]);
    expect(rows).toHaveLength(1);
  });

  it("blocks delete when the challenge has a recorded winner", async () => {
    const server = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
    const challengeId = await createOwnedChallenge(await createUser(), "Deletable Challenge");
    const repoId = await createEntrant(challengeId, "Winning Team");
    await pool.query(
      `INSERT INTO challenge_winners (challenge_id, rank, repo_id, set_by) VALUES ($1, 1, $2, $3)`,
      [challengeId, repoId, admin],
    );

    const res = await server.inject({
      method: "DELETE",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(admin),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.hasWinners).toBe(true);
  });

  it("blocks delete when the challenge is assigned to a room", async () => {
    const server = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);
    const challengeId = await createOwnedChallenge(await createUser(), "Deletable Challenge");
    const roomId = await seedRoom("delete-test-room");
    const { rows: enterpriseRows } = await pool.query(
      `SELECT s.enterprise_id FROM challenges c JOIN sponsors s ON s.id = c.author WHERE c.id = $1`,
      [challengeId],
    );
    await pool.query(`INSERT INTO room_enterprises (room_id, enterprise_id) VALUES ($1, $2)`, [
      roomId,
      enterpriseRows[0].enterprise_id,
    ]);
    await pool.query(`INSERT INTO room_queue_groups (room_id, queue_group_id) VALUES ($1, $2)`, [
      roomId,
      await groupOf(challengeId),
    ]);

    const res = await server.inject({
      method: "DELETE",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(admin),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.assignedToRoom).toBe(true);
  });

  it("denies delete to a caller without challenge-management capability, including the owning sponsor rep", async () => {
    const server = await getApp();
    const owner = await createUser();
    const challengeId = await createOwnedChallenge(owner, "Deletable Challenge");

    const anonymous = await server.inject({
      method: "DELETE",
      url: `/api/challenges/${challengeId}`,
    });
    expect(anonymous.statusCode).toBe(401);

    // Ownership grants edit access but not delete — delete is admin-only.
    const asOwner = await server.inject({
      method: "DELETE",
      url: `/api/challenges/${challengeId}`,
      headers: asUser(owner),
    });
    expect(asOwner.statusCode).toBe(403);

    const { rows } = await pool.query(`SELECT 1 FROM challenges WHERE id = $1`, [challengeId]);
    expect(rows).toHaveLength(1);
  });

  it("404s deleting a challenge that does not exist", async () => {
    const server = await getApp();
    const admin = await createUserWithCapabilities([CAPABILITIES.SPONSORS_MANAGE]);

    const res = await server.inject({
      method: "DELETE",
      url: "/api/challenges/999999",
      headers: asUser(admin),
    });
    expect(res.statusCode).toBe(404);
  });
});
