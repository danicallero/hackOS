import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { audit } from "../../src/lib/audit.js";
import { asUser, createUser, createUserWithCapabilities, useTestApp } from "../helpers.js";

const getApp = useTestApp();

it("searches audit actors without case or accent sensitivity (H53)", async () => {
  const app = await getApp();
  const reader = await createUserWithCapabilities([CAPABILITIES.AUDIT_READ]);
  const jose = await createUser({ name: "José", email: "jose@example.test" });
  const joseLower = await createUser({ name: "josé", email: "jose-lower@example.test" });
  for (const actorId of [jose, joseLower]) {
    await audit(pool, {
      actorId,
      entityType: "user",
      entityId: actorId,
      action: "profile_update",
    });
  }

  for (const [actorQuery, actorId] of [
    ["jose", jose],
    ["JOSE", joseLower],
  ] as const) {
    const result = await app.inject({
      method: "GET",
      url: `/api/audit?actorQuery=${actorQuery}`,
      headers: asUser(reader),
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().items.map((row: { actor_id: number }) => row.actor_id)).toContain(actorId);
  }
});
