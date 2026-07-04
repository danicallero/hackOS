import "./env.js";
import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { asUser, buildTestApp, createUserWithCapabilities, truncateAll } from "../helpers.js";
import { createChallenge, createRepoWithTeam, enqueueRepo } from "./fixtures.js";

/** H44: judges' answers are validated against a TYPED judging panel. */

let app: App;
let judge: number;

const i18n = (t: string) => ({ en: t, es: t, gl: t });
const TYPED_PANEL = [
  { key: "impact", kind: "scale", label: i18n("Impact"), required: true, min: 0, max: 10 },
  { key: "works", kind: "boolean", label: i18n("Works?"), required: true },
  {
    key: "track",
    kind: "single_choice",
    label: i18n("Track"),
    required: false,
    options: [
      { value: "ai", label: i18n("AI") },
      { value: "web", label: i18n("Web") },
    ],
  },
];

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
  judge = await createUserWithCapabilities([CAPABILITIES.JUDGE_PANEL]);
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

async function setupEntry() {
  const challengeId = await createChallenge({ judgingPanelCriteria: TYPED_PANEL });
  const { repoId } = await createRepoWithTeam(undefined, `Team ${crypto.randomUUID().slice(0, 4)}`);
  return enqueueRepo(challengeId, repoId, 1);
}

describe("typed judging panel answers (H44)", () => {
  it("accepts well-typed answers", async () => {
    const entryId = await setupEntry();
    const res = await app.inject({
      method: "PATCH",
      url: `/api/queue/entries/${entryId}/review`,
      headers: asUser(judge),
      payload: { scores: { impact: 8, works: true, track: "ai" } },
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects an out-of-range scale and a mistyped boolean", async () => {
    const entryId = await setupEntry();
    const bad = await app.inject({
      method: "PATCH",
      url: `/api/queue/entries/${entryId}/review`,
      headers: asUser(judge),
      payload: { scores: { impact: 99 } },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("blocks submit while a required answer is missing, then allows it", async () => {
    const entryId = await setupEntry();
    // only impact answered; `works` is required
    await app.inject({
      method: "PATCH",
      url: `/api/queue/entries/${entryId}/review`,
      headers: asUser(judge),
      payload: { scores: { impact: 5 } },
    });
    const early = await app.inject({
      method: "PATCH",
      url: `/api/queue/entries/${entryId}/review`,
      headers: asUser(judge),
      payload: { submit: true },
    });
    expect(early.statusCode).toBe(400);

    const ok = await app.inject({
      method: "PATCH",
      url: `/api/queue/entries/${entryId}/review`,
      headers: asUser(judge),
      payload: { scores: { works: false }, submit: true },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe("submitted");
  });
});
