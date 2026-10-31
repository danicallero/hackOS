import "./env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { truncateAll } from "../helpers.js";

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  const { pool } = await import("../../src/db/pool.js");
  await pool.end();
});

describe("schedule.visibility (#1187)", () => {
  const insert = async (visibility: string) => {
    const { pool } = await import("../../src/db/pool.js");
    return pool.query(
      `INSERT INTO schedule (title, starts_at, ends_at, visibility, audiences)
       VALUES ('Opening', now(), now() + interval '1 hour', $1, '{participant}')`,
      [visibility],
    );
  };

  it("accepts the two values the API serializes", async () => {
    await expect(insert("shown")).resolves.toBeDefined();
    await expect(insert("hidden")).resolves.toBeDefined();
  });

  it("rejects any other value instead of breaking the public lists later", async () => {
    await expect(insert("public")).rejects.toMatchObject({
      constraint: "schedule_visibility_check",
    });
  });
});
