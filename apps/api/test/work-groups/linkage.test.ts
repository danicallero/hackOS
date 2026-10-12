import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool, withTransaction } from "../../src/db/pool.js";
import { createUser, truncateAll } from "../helpers.js";
import { admitParticipant, createChallenge, setHackingWindow } from "../projects/fixtures.js";

beforeEach(truncateAll);
afterAll(async () => {
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await closeValkey();
  await pool.end();
});

describe("planning/import merge (#854)", () => {
  it("links on a later URL edit and persists the project's own preference", async () => {
    const actor = await createUser();
    await admitParticipant(actor);
    await setHackingWindow(true);
    const url = "https://devpost.com/software/late-url";
    const group = (
      await pool.query(
        `INSERT INTO planned_work_groups (name,created_by,presentation_timing_preference) VALUES ('Planners',$1,'late') RETURNING id`,
        [actor],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO planned_work_group_members (group_id,user_id,status) VALUES ($1,$2,'active')`,
      [group, actor],
    );
    const repo = (
      await pool.query(
        `INSERT INTO repos (name,description,devpost_url,devpost_canonical_url) VALUES ('Devpost title','Devpost description','https://event.devpost.com/submissions/987-project',$1) RETURNING id`,
        [url],
      )
    ).rows[0].id;
    const { updateGroup } = await import("../../src/modules/work-groups/service.js");
    const updated = await updateGroup(actor, group, { devpostUrl: url });
    expect(Number(updated.linked_repo_id)).toBe(repo);
    expect(updated.name).toBe("Devpost title");
    const { updateMyProject } = await import("../../src/modules/projects/service.js");
    const edited = await updateMyProject(actor, repo, { presentationTimingPreference: "middle" });
    expect(edited.presentation_timing_preference).toBe("middle");
    const { getMine } = await import("../../src/modules/work-groups/service.js");
    expect((await getMine(actor, Number(group))).presentation_timing_preference).toBe("middle");
  });

  it("links aliases and preference without unioning source rosters or changing queue positions", async () => {
    const actor = await createUser();
    const matched = await createUser();
    const extra = await createUser();
    const pending = await createUser();
    const publicUrl = "https://devpost.com/software/blackvault-m92vqk";
    const group = (
      await pool.query(
        `INSERT INTO planned_work_groups
      (name,description,created_by,devpost_url,devpost_canonical_url,presentation_timing_preference)
      VALUES ('Planning','Planning description',$1,$2,$2,'early') RETURNING id`,
        [actor, publicUrl],
      )
    ).rows[0].id;
    const repo = (
      await pool.query(
        `INSERT INTO repos (name,description,devpost_url,devpost_canonical_url)
      VALUES ('Imported','Imported description','https://hackudc-2026.devpost.com/submissions/954962-blackvault',$1) RETURNING id`,
        [publicUrl],
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO planned_work_group_members (group_id,user_id,status)
      VALUES ($1,$2,'active'),($1,$3,'active'),($1,$4,'invited')`,
      [group, matched, extra, pending],
    );
    await pool.query(
      `INSERT INTO devpost_participants (repo_id,email,user_id,merge_status,import_batch)
      VALUES ($1,'matched@test.local',$2,'auto_matched','test')`,
      [repo, matched],
    );
    await pool.query(
      `INSERT INTO submissions (repo_id,user_id,imported_from) VALUES ($1,$2,'devpost')`,
      [repo, matched],
    );
    const challenge = await createChallenge("Challenge", []);
    await pool.query(
      `INSERT INTO queue_entries (repo_id,challenge_id,position) VALUES ($1,$2,118)`,
      [repo, challenge],
    );
    const { linkDevpostImports } = await import("../../src/modules/work-groups/service.js");
    await withTransaction((db) => linkDevpostImports(db, actor, [repo]));
    expect(
      (
        await pool.query(
          `SELECT name,description,linked_repo_id FROM planned_work_groups WHERE id=$1`,
          [group],
        )
      ).rows[0],
    ).toEqual({ name: "Imported", description: "Imported description", linked_repo_id: repo });
    expect(
      (await pool.query(`SELECT presentation_timing_preference FROM repos WHERE id=$1`, [repo]))
        .rows[0].presentation_timing_preference,
    ).toBe("early");
    expect(
      (
        await pool.query(
          `SELECT user_id,status FROM submissions WHERE repo_id=$1 ORDER BY user_id`,
          [repo],
        )
      ).rows,
    ).toEqual([{ user_id: matched, status: "active" }]);
    await withTransaction((db) => linkDevpostImports(db, actor, [repo]));
    expect(
      (await pool.query(`SELECT count(*)::int n FROM submissions WHERE repo_id=$1`, [repo])).rows[0]
        .n,
    ).toBe(1);
    expect(
      (await pool.query(`SELECT position FROM queue_entries WHERE repo_id=$1`, [repo])).rows[0]
        .position,
    ).toBe(118);
    const { updateRepo } = await import("../../src/modules/projects/service.js");
    await expect(updateRepo(actor, repo, { presentationTimingPreference: "late" })).rejects.toThrow(
      "after queues are generated",
    );
    expect(
      (
        await updateRepo(actor, repo, {
          name: "Metadata edit",
          presentationTimingPreference: "early",
        })
      ).name,
    ).toBe("Metadata edit");
  });

  it("does not choose between two groups with the same resolved identity", async () => {
    const actor = await createUser();
    const url = "https://devpost.com/software/tie";
    await pool.query(
      `INSERT INTO planned_work_groups (name,created_by,devpost_url,devpost_canonical_url)
      VALUES ('One',$1,$2,$2),('Two',$1,$2,$2)`,
      [actor, url],
    );
    const repo = (
      await pool.query(
        `INSERT INTO repos (name,devpost_url,devpost_canonical_url)
      VALUES ('Import',$1,$1) RETURNING id`,
        [url],
      )
    ).rows[0].id;
    const { linkDevpostImports } = await import("../../src/modules/work-groups/service.js");
    await withTransaction((db) => linkDevpostImports(db, actor, [repo]));
    expect((await pool.query(`SELECT linked_repo_id FROM planned_work_groups`)).rows).toEqual([
      { linked_repo_id: null },
      { linked_repo_id: null },
    ]);
  });
});
