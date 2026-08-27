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
import { assignBadge, issueTicket } from "./fixtures.js";

let app: App;
let staff: number;
let admin: number;

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  staff = await createUserWithCapabilities([CAPABILITIES.ACCREDIT_SCAN]);
  admin = await createUserWithCapabilities(["*"]);
  app ??= await buildTestApp();
});

afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  const { pool } = await import("../../src/db/pool.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

async function search(q: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/logistics/people/search",
    headers: asUser(staff),
    payload: { q },
  });
  expect(res.statusCode).toBe(200);
  return res.json().results as Array<{ userId: number }>;
}

describe("unified person lookup excludes anonymized profiles (H54)", () => {
  it("never matches an anonymized user by ticket, badge, badge history, or fuzzy name", async () => {
    const { pool } = await import("../../src/db/pool.js");
    const userId = await createUser({ name: "Ada Lovelace", email: "ada@example.test" });
    const ticketToken = await issueTicket(userId, "ticket-anon");
    await assignBadge(userId, "BADGE-ANON-CURRENT");
    await pool.query(
      `INSERT INTO check_in_logs (user_id, badge_id) VALUES ($1, 'BADGE-ANON-CURRENT')`,
      [userId],
    );

    // Rotate once so a badge_history entry exists too.
    const rotate = await app.inject({
      method: "POST",
      url: "/api/accreditation/rotate",
      headers: { ...asUser(staff), "idempotency-key": "rotate-for-anon-search" },
      payload: {
        userId,
        currentBadgeId: "BADGE-ANON-CURRENT",
        newBadgeId: "BADGE-ANON-NEW",
        reason: "lost",
      },
    });
    expect(rotate.statusCode).toBe(200);

    expect(await search(ticketToken)).toHaveLength(1);
    expect(await search("BADGE-ANON-NEW")).toHaveLength(1);
    expect(await search("BADGE-ANON-CURRENT")).toHaveLength(1);
    expect(await search("Lovelace")).toHaveLength(1);

    const anon = await app.inject({
      method: "POST",
      url: `/api/users/${userId}/anonymize`,
      headers: asUser(admin),
    });
    expect(anon.statusCode).toBe(200);

    expect(await search(ticketToken)).toHaveLength(0);
    expect(await search("BADGE-ANON-NEW")).toHaveLength(0);
    expect(await search("BADGE-ANON-CURRENT")).toHaveLength(0);
    expect(await search("Lovelace")).toHaveLength(0);
  });
});
