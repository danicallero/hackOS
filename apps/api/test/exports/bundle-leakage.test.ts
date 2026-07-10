import "./env.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildExportBundle } from "../../src/modules/exports/bundle.js";
import { createUser, truncateAll } from "../helpers.js";
import {
  addReview,
  createApplicationResponse,
  createChallenge,
  createRepoWithSubmission,
  enqueueRepo,
  joinJudgingSession,
  setAttemptReview,
} from "./fixtures.js";

/** H54: a subject's export bundle must never leak another user's data. */

beforeEach(async () => {
  await truncateAll();
  const { valkey } = await import("../../src/lib/valkey.js");
  await valkey.flushdb();
});

afterAll(async () => {
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  const { pool } = await import("../../src/db/pool.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});

describe("buildExportBundle (H54)", () => {
  it("excludes another user's applications/projects entirely", async () => {
    const a = await createUser({ email: "a@example.test", name: "Alice" });
    const b = await createUser({ email: "b@example.test", name: "Bob" });

    await createApplicationResponse(a, { appName: "Alice App" });
    const { responseId: bResponseId } = await createApplicationResponse(b, { appName: "Bob App" });
    await addReview(bResponseId, a, 80, "Bob's secret review notes");

    const bundleA = await buildExportBundle(a);
    const serialized = JSON.stringify(bundleA);
    expect(serialized).not.toContain("Bob");
    expect(serialized).not.toContain("b@example.test");
    expect(serialized).not.toContain("Bob's secret review notes");
    expect(serialized).toContain("Alice App");
  });

  it("excludes projects/judging content reached only via the subject acting as staff", async () => {
    const judgeA = await createUser({ email: "judgeA@example.test", name: "JudgeA" });
    const teamMemberB = await createUser({ email: "teamB@example.test", name: "TeamB" });

    const challengeId = await createChallenge(judgeA, "Secret Challenge");
    const repoId = await createRepoWithSubmission(teamMemberB, "Bob's Secret Repo");
    const entryId = await enqueueRepo(challengeId, repoId);
    await setAttemptReview(entryId, judgeA, { innovation: 9 });
    await joinJudgingSession(judgeA, entryId);

    const bundleA = await buildExportBundle(judgeA);
    const serialized = JSON.stringify(bundleA);
    expect(serialized).not.toContain("Bob's Secret Repo");
    expect(serialized).not.toContain("TeamB");

    // Sanity: judgeA's OWN submissions (none created here) would appear —
    // confirmed indirectly by the absence of any judgingParticipation/projects
    // entries for a user who only ever acted as staff.
    const bundle = bundleA as {
      judgingParticipation: unknown[];
      projects: { submissions: unknown[] };
    };
    expect(bundle.judgingParticipation).toEqual([]);
    expect(bundle.projects.submissions).toEqual([]);
  });

  it("omits push token values, keeping only metadata", async () => {
    const a = await createUser();
    const { registerPushToken } = await import("./fixtures.js");
    await registerPushToken(a, "SECRET_EXPO_TOKEN");

    const bundle = await buildExportBundle(a);
    expect(JSON.stringify(bundle)).not.toContain("SECRET_EXPO_TOKEN");
  });
});
