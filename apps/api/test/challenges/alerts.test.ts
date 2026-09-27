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
import { admitParticipant } from "../projects/fixtures.js";
import { createEnterpriseChallenges, createRepoWithTeam, enqueueRepo } from "../queue/fixtures.js";

describe("challenge alerts (#856)", () => {
  let app: App;
  beforeAll(async () => {
    app = await buildTestApp();
  });
  beforeEach(truncateAll);
  afterAll(async () => app.close());

  const payload = {
    title: { en: "Challenge update", es: "Actualización del reto", gl: "Actualización do reto" },
    body: {
      en: "Please check the new details.",
      es: "Consulta los nuevos detalles.",
      gl: "Consulta os novos detalles.",
    },
  };

  it("limits sponsors to their enterprise, deduplicates entered and planned members, and audits the alert", async () => {
    const { repId, challengeIds } = await createEnterpriseChallenges(1);
    const challengeId = challengeIds[0]!;
    const participant = await createUser({ email: "alert-recipient@test.local" });
    const plannedOnly = await createUser({ email: "alert-planned@test.local" });
    await pool.query(`UPDATE users SET language = 'es' WHERE id = $1`, [participant]);
    await pool.query(`UPDATE users SET language = 'gl' WHERE id = $1`, [plannedOnly]);
    await admitParticipant(participant);
    await admitParticipant(plannedOnly);
    const { repoId } = await createRepoWithTeam([participant]);
    await enqueueRepo(challengeId, repoId, 1);
    const created = await app.inject({
      method: "POST",
      url: "/api/me/work-groups",
      headers: { ...asUser(participant), "idempotency-key": "alert-group" },
      payload: { name: "Alert planners" },
    });
    const groupId = created.json().id;
    await app.inject({
      method: "POST",
      url: `/api/me/work-groups/${groupId}/invites`,
      headers: { ...asUser(participant), "idempotency-key": "alert-invite" },
      payload: { email: "alert-planned@test.local" },
    });
    await app.inject({
      method: "POST",
      url: `/api/me/work-groups/${groupId}/invites/accept`,
      headers: { ...asUser(plannedOnly), "idempotency-key": "alert-accept" },
    });
    await app.inject({
      method: "POST",
      url: `/api/me/work-groups/${groupId}/challenges`,
      headers: { ...asUser(participant), "idempotency-key": "alert-intent" },
      payload: { challengeId },
    });

    const sent = await app.inject({
      method: "POST",
      url: `/api/challenges/${challengeId}/alerts`,
      headers: { ...asUser(repId), "idempotency-key": "challenge-alert" },
      payload,
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toEqual({ recipients: 2 });
    const outbox = await pool.query(
      `SELECT user_id, channel, payload FROM notification_outbox WHERE category = 'challenge' ORDER BY user_id, channel`,
    );
    expect(outbox.rows).toHaveLength(6);
    expect(outbox.rows.filter((row) => row.user_id === participant)).toHaveLength(3);
    expect(outbox.rows.find((row) => row.user_id === participant)?.payload.subject).toBe(
      payload.title.es,
    );
    expect(outbox.rows.find((row) => row.user_id === plannedOnly)?.payload.subject).toBe(
      payload.title.gl,
    );
    expect(
      (
        await pool.query(
          `SELECT after FROM audit_log WHERE entity_type='challenge' AND action='alert.send'`,
        )
      ).rows[0].after,
    ).toMatchObject({ target: "challenge", recipientCount: 2 });

    const { challengeIds: foreignIds } = await createEnterpriseChallenges(1);
    const foreign = await app.inject({
      method: "POST",
      url: `/api/challenges/${foreignIds[0]!}/alerts`,
      headers: { ...asUser(repId), "idempotency-key": "foreign-alert" },
      payload,
    });
    expect(foreign.statusCode).toBe(403);
  });

  it("allows staff to target all admitted participants but keeps that target out of sponsor reach", async () => {
    const { repId, challengeIds } = await createEnterpriseChallenges(1);
    const staff = await createUserWithCapabilities([CAPABILITIES.CHALLENGES_MANAGE]);
    await pool.query(
      `UPDATE roles SET event_access = false WHERE id IN (SELECT role_id FROM user_roles WHERE user_id = $1)`,
      [staff],
    );
    const admitted = await createUser();
    const notAdmitted = await createUser();
    await admitParticipant(admitted);

    const sponsorAttempt = await app.inject({
      method: "POST",
      url: `/api/challenges/${challengeIds[0]!}/alerts`,
      headers: { ...asUser(repId), "idempotency-key": "sponsor-all" },
      payload: { ...payload, target: "participants" },
    });
    expect(sponsorAttempt.statusCode).toBe(403);
    const staffSend = await app.inject({
      method: "POST",
      url: `/api/challenges/${challengeIds[0]!}/alerts`,
      headers: { ...asUser(staff), "idempotency-key": "staff-all" },
      payload: { ...payload, target: "participants" },
    });
    expect(staffSend.statusCode).toBe(200);
    expect(staffSend.json()).toEqual({ recipients: 1 });
    const recipientIds = (
      await pool.query(
        `SELECT DISTINCT user_id FROM notification_outbox WHERE category='challenge'`,
      )
    ).rows.map((row) => row.user_id);
    expect(recipientIds).toEqual([admitted]);
    expect(recipientIds).not.toContain(notAdmitted);
  });
});
