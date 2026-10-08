import { CAPABILITIES } from "@hackos/shared/capabilities";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { App } from "../../src/app.js";
import { pool } from "../../src/db/pool.js";
import {
  asUser,
  buildTestApp,
  createUser,
  createUserWithCapabilities,
  truncateAll,
} from "../helpers.js";
import { createEnterpriseChallenges, enqueueRepo } from "../queue/fixtures.js";
import { admitParticipant, setHackingWindow } from "./fixtures.js";

let app: App;
let owner: number;
let admin: number;
beforeEach(async () => {
  await truncateAll();
  await pool.query(
    `UPDATE queue_settings SET schedule_start_at=NULL,schedule_end_at=NULL WHERE id=1`,
  );
  if (!app) app = await buildTestApp();
  owner = await createUser({ email: "alice@school.test" });
  await admitParticipant(owner);
  admin = await createUserWithCapabilities([
    CAPABILITIES.PROJECTS_EDIT,
    CAPABILITIES.PROJECTS_IMPORT,
    CAPABILITIES.QUEUE_ADMIN,
  ]);
  await setHackingWindow(true);
  await pool.query(`UPDATE event_config SET participants_can_create_projects=true WHERE id=1`);
});
afterAll(async () => {
  await app?.close();
  const { stopQueues } = await import("../../src/lib/queues.js");
  const { closeValkey } = await import("../../src/lib/valkey.js");
  await stopQueues();
  await closeValkey();
  await pool.end();
});
async function group(name = "Alpha") {
  const r = await app.inject({
    method: "POST",
    url: "/api/me/work-groups",
    headers: asUser(owner),
    payload: { name },
  });
  expect(r.statusCode).toBe(200);
  return r.json().id as number;
}
async function groupCode(id: number) {
  return (
    await app.inject({ method: "GET", url: `/api/me/work-groups/${id}`, headers: asUser(owner) })
  ).json().reconciliation_code as string;
}
async function submit(id: number, stage = "work-groups") {
  return app.inject({
    method: "POST",
    url: `/api/me/${stage}/${id}/submit`,
    headers: asUser(owner),
    payload: {},
  });
}
function csv(url: string, code = "", emails = "alice@school.test", title = "Imported") {
  return `Project Title,Submission Url,Event project code,Team Members\n${title},${url},${code},"${emails}"`;
}
async function importCsv(text: string) {
  const r = await app.inject({
    method: "POST",
    url: "/api/devpost/imports/confirm",
    headers: asUser(admin),
    payload: { projectsCsv: text, participantsCsv: "Email,Project Title" },
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json().repos[0].id as number;
}
async function detail(id: number) {
  return (
    await app.inject({
      method: "GET",
      url: `/api/me/projects/${id}/submission`,
      headers: asUser(owner),
    })
  ).json();
}
async function deadline() {
  await pool.query(
    `UPDATE event_config SET hacking_ends_at=now()-interval '1 minute',hacking_starts_at=now()-interval '2 hours' WHERE id=1`,
  );
}

describe("native lifecycle and authorization (H18-H21,H53)", () => {
  it("keeps an internal-only planning project independent, with an immutable code and multiple projects", async () => {
    const a = await group(),
      b = await group("Beta");
    expect(a).not.toBe(b);
    expect(await groupCode(a)).toMatch(/^[A-F0-9]{8}$/);
    expect(await groupCode(a)).not.toBe(await groupCode(b));
    expect((await pool.query(`SELECT count(*)::int n FROM repos`)).rows[0].n).toBe(0);
    await expect(
      pool.query(`UPDATE planned_work_groups SET reconciliation_code='BAD' WHERE id=$1`, [a]),
    ).rejects.toThrow("immutable");
  });
  it("submits, locks every participant path, requests edits, reopens and resubmits without destroying history", async () => {
    const id = await group();
    const first = await submit(id);
    expect(first.statusCode, first.body).toBe(200);
    const repo = first.json().repoId;
    expect(await detail(repo)).toMatchObject({
      status: "submitted",
      submittedVia: "native",
      eligible: true,
      lockReason: "native_submission",
    });
    for (const [method, url, payload] of [
      ["PATCH", `/api/me/projects/${repo}`, { name: "Oops" }],
      ["PATCH", `/api/me/work-groups/${id}`, { name: "Oops" }],
      ["POST", `/api/me/projects/${repo}/invites`, { email: "other@school.test" }],
    ] as const) {
      const r = await app.inject({ method, url, headers: asUser(owner), payload });
      expect(r.statusCode).toBe(409);
    }
    const request = await app.inject({
      method: "POST",
      url: `/api/me/projects/${repo}/edit-requests`,
      headers: asUser(owner),
      payload: { reason: "Fix the demo" },
    });
    expect(request.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${repo}/unlock`,
          headers: asUser(owner),
          payload: { reason: "Self unlock", decision: "unlock" },
        })
      ).statusCode,
    ).toBe(403);
    const reopen = await app.inject({
      method: "POST",
      url: `/api/projects/${repo}/unlock`,
      headers: asUser(admin),
      payload: { reason: "Correction approved", decision: "approve" },
    });
    expect(reopen.statusCode, reopen.body).toBe(200);
    expect(await detail(repo)).toMatchObject({ status: "draft", lockedAt: null, eligible: false });
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/me/projects/${repo}`,
          headers: asUser(owner),
          payload: { name: "Corrected" },
        })
      ).statusCode,
    ).toBe(200);
    expect((await submit(repo, "projects")).statusCode).toBe(200);
    const snapshots = await pool.query(
      `SELECT snapshot FROM project_submission_versions WHERE repo_id=$1 ORDER BY id`,
      [repo],
    );
    expect(snapshots.rows.length).toBe(3);
    expect(snapshots.rows[0].snapshot.project.name).toBe("Alpha");
    expect(snapshots.rows[2].snapshot.project.name).toBe("Corrected");
    expect(
      (
        await pool.query(`SELECT action FROM audit_log WHERE entity_type='repo' AND entity_id=$1`, [
          String(repo),
        ])
      ).rows.map((r) => r.action),
    ).toEqual(expect.arrayContaining(["submit", "request_edits", "unlock"]));
  });
  it("denies edit requests without unlocking and allows audited direct reopen after the deadline", async () => {
    const repo = (await submit(await group())).json().repoId;
    await app.inject({
      method: "POST",
      url: `/api/me/projects/${repo}/edit-requests`,
      headers: asUser(owner),
      payload: { reason: "Please" },
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${repo}/unlock`,
          headers: asUser(admin),
          payload: { reason: "Not appropriate", decision: "deny" },
        })
      ).statusCode,
    ).toBe(200);
    expect((await detail(repo)).lockedAt).not.toBeNull();
    await deadline();
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${repo}/unlock`,
          headers: asUser(admin),
          payload: { reason: "Late correction allowed", decision: "unlock" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/me/projects/${repo}`,
          headers: asUser(owner),
          payload: { name: "Late correction" },
        })
      ).statusCode,
    ).toBe(200);
    expect((await submit(repo, "projects")).statusCode).toBe(200);
  });
  it("serializes concurrent native submissions into one project and one submitted version", async () => {
    const id = await group();
    const results = await Promise.all([submit(id), submit(id)]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect((await pool.query(`SELECT count(*)::int n FROM repos`)).rows[0].n).toBe(1);
    expect(
      (await pool.query(`SELECT count(*)::int n FROM project_submission_versions`)).rows[0].n,
    ).toBe(1);
  });
  it("rejects nonmembers from submit, editing, requests and unrelated claims", async () => {
    const id = await group();
    const stranger = await createUser();
    await admitParticipant(stranger);
    const r = await app.inject({
      method: "POST",
      url: `/api/me/work-groups/${id}/submit`,
      headers: asUser(stranger),
      payload: {},
    });
    expect(r.statusCode).toBe(403);
    const repo = await importCsv(csv("https://devpost.com/software/a"));
    for (const url of [
      `/api/me/projects/${repo}/claim`,
      `/api/me/projects/${repo}/edit-requests`,
    ]) {
      const x = await app.inject({
        method: "POST",
        url,
        headers: asUser(stranger),
        payload: url.endsWith("claim") ? {} : { reason: "Bad" },
      });
      expect(x.statusCode).toBe(403);
    }
  });
});

describe("safe Devpost reconciliation (H6,H16,H17,H30)", () => {
  it("matches an exact code, stays editable before deadline, then locks after deadline without losing preference", async () => {
    const id = await group();
    await app.inject({
      method: "PATCH",
      url: `/api/me/work-groups/${id}`,
      headers: asUser(owner),
      payload: { presentationTimingPreference: "late" },
    });
    const code = await groupCode(id);
    const repo = await importCsv(csv("https://devpost.com/software/alpha", code));
    expect(
      (await pool.query(`SELECT linked_repo_id FROM planned_work_groups WHERE id=$1`, [id])).rows[0]
        .linked_repo_id,
    ).toBe(repo);
    expect((await detail(repo)).lockedAt).toBeNull();
    await deadline();
    await importCsv(csv("https://devpost.com/software/alpha", code));
    expect(await detail(repo)).toMatchObject({
      lockReason: "devpost_deadline_import",
      code,
      eligible: true,
    });
    expect(
      (await pool.query(`SELECT presentation_timing_preference FROM repos WHERE id=$1`, [repo]))
        .rows[0].presentation_timing_preference,
    ).toBe("late");
  });
  it("creates a Devpost-only project and permits a recognized user to confirm it", async () => {
    await deadline();
    const repo = await importCsv(csv("https://devpost.com/software/new"));
    expect(await detail(repo)).toMatchObject({ eligible: true, submittedVia: "devpost" });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/me/projects/${repo}/claim`,
          headers: asUser(owner),
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
  });
  it("links a recognized imported project to a planning project and rejects membership conflicts", async () => {
    const id = await group();
    const repo = await importCsv(csv("https://devpost.com/software/a"));
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/me/projects/${repo}/claim`,
          headers: asUser(owner),
          payload: { groupId: id },
        })
      ).statusCode,
    ).toBe(200);
    const other = await group("Other");
    const conflict = await importCsv(
      csv("https://devpost.com/software/conflict", "", "alice@school.test;unknown@unknown.test"),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/me/projects/${conflict}/claim`,
          headers: asUser(owner),
          payload: { groupId: other },
        })
      ).statusCode,
    ).toBe(409);
  });
  it("counts two verified emails as one person and leaves unverified addresses unresolved", async () => {
    await pool.query(
      `UPDATE users SET secondary_email='alice@personal.test',secondary_email_verified_at=now() WHERE id=$1`,
      [owner],
    );
    const repo = await importCsv(
      csv("https://devpost.com/software/a", "", "alice@school.test;alice@personal.test"),
    );
    expect(await detail(repo)).toMatchObject({ participantCount: 1, unresolvedCount: 0 });
    await pool.query(`UPDATE users SET secondary_email_verified_at=NULL WHERE id=$1`, [owner]);
    await importCsv(
      csv("https://devpost.com/software/a", "", "alice@school.test;alice@personal.test"),
    );
    expect(await detail(repo)).toMatchObject({
      participantCount: 2,
      unresolvedCount: 1,
      eligible: false,
    });
    await pool.query(`UPDATE users SET secondary_email_verified_at=now() WHERE id=$1`, [owner]);
    const { reconcileDevpostParticipantsForUser } = await import(
      "../../src/modules/projects/reconciliation.js"
    );
    await reconcileDevpostParticipantsForUser(pool, owner);
    expect(await detail(repo)).toMatchObject({
      participantCount: 1,
      unresolvedCount: 0,
      eligible: true,
    });
  });
  it("never establishes identity through an unverified primary email", async () => {
    const unverified = await createUser({ email: "unverified@school.test", emailVerified: false });
    const repo = await importCsv(
      csv("https://devpost.com/software/a", "", "alice@school.test;unverified@school.test"),
    );
    expect(
      (
        await pool.query(
          `SELECT user_id FROM devpost_participants WHERE repo_id=$1 AND email='unverified@school.test'`,
          [repo],
        )
      ).rows[0].user_id,
    ).toBeNull();
    const { reconcileDevpostParticipantsForUser } = await import(
      "../../src/modules/projects/reconciliation.js"
    );
    await reconcileDevpostParticipantsForUser(pool, unverified);
    expect((await detail(repo)).unresolvedCount).toBe(1);
  });
  it("does not union discrepant participant lists; admin source selection and exceptions are audited", async () => {
    const bob = await createUser({ email: "bob@school.test" });
    await admitParticipant(bob);
    const id = await group();
    await pool.query(
      `INSERT INTO planned_work_group_members(group_id,user_id,status) VALUES($1,$2,'active')`,
      [id, bob],
    );
    await pool.query(`UPDATE event_config SET project_max_team_size=1 WHERE id=1`);
    const repo = await importCsv(csv("https://devpost.com/software/a", await groupCode(id)));
    expect(await detail(repo)).toMatchObject({ membershipDiffers: true, eligible: false });
    expect(
      (await pool.query(`SELECT count(*)::int n FROM submissions WHERE repo_id=$1`, [repo])).rows[0]
        .n,
    ).toBe(1);
    const resolve = await app.inject({
      method: "POST",
      url: `/api/projects/${repo}/resolve`,
      headers: asUser(admin),
      payload: { membership: "internal", reason: "Keep accepted members" },
    });
    expect(resolve.statusCode, resolve.body).toBe(200);
    expect(await detail(repo)).toMatchObject({
      participantCount: 2,
      teamSizeViolation: true,
      eligible: false,
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${repo}/resolve`,
          headers: asUser(admin),
          payload: { teamSizeException: true, reason: "Event exception" },
        })
      ).statusCode,
    ).toBe(200);
    expect((await detail(repo)).eligible).toBe(true);
    expect(
      (await pool.query(`SELECT count(*)::int n FROM audit_log WHERE action='resolve_exception'`))
        .rows[0].n,
    ).toBe(2);
  });
  it("preserves native-only eligibility and marks draft operational records unsubmitted at deadline", async () => {
    const submitted = (await submit(await group())).json().repoId;
    const draft = await pool.query(
      `INSERT INTO repos(name,source,submission_status,submitted_via) VALUES('Draft','native','draft',NULL) RETURNING id`,
    );
    await deadline();
    await importCsv(csv("https://devpost.com/software/new"));
    expect((await detail(submitted)).eligible).toBe(true);
    expect(
      (await pool.query(`SELECT submission_status FROM repos WHERE id=$1`, [draft.rows[0].id]))
        .rows[0].submission_status,
    ).toBe("not_submitted");
  });
  it("repeated imports and title/display URL changes preserve confirmed project links", async () => {
    const native = (await submit(await group())).json().repoId;
    const code = (await detail(native)).code;
    const url = "https://devpost.com/software/a";
    expect(await importCsv(csv(url, code))).toBe(native);
    await pool.query(
      `UPDATE repos SET devpost_url='https://devpost.com/software/edited' WHERE id=$1`,
      [native],
    );
    expect(await importCsv(csv(url, "", "", "Renamed"))).toBe(native);
    expect((await pool.query(`SELECT count(*)::int n FROM repos`)).rows[0].n).toBe(1);
    expect((await detail(native)).submittedVia).toBe("native");
  });
  it("audits mistaken planning links and does not restore them on a repeated code import", async () => {
    const id = await group();
    const code = await groupCode(id);
    const repo = await importCsv(csv("https://devpost.com/software/wrong", code));
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/projects/${repo}/unlink`,
          headers: asUser(owner),
          payload: { reason: "No" },
        })
      ).statusCode,
    ).toBe(403);
    const result = await app.inject({
      method: "POST",
      url: `/api/projects/${repo}/unlink`,
      headers: asUser(admin),
      payload: { reason: "Code entered on the wrong project" },
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(await importCsv(csv("https://devpost.com/software/wrong", code))).toBe(repo);
    expect(
      (await pool.query(`SELECT linked_repo_id FROM planned_work_groups WHERE id=$1`, [id])).rows[0]
        .linked_repo_id,
    ).toBeNull();
    expect(
      (
        await pool.query(
          `SELECT reason FROM audit_log WHERE entity_type='repo' AND entity_id=$1 AND action='unlink_project'`,
          [String(repo)],
        )
      ).rows[0].reason,
    ).toContain("wrong project");
  });
  it("separates a mistaken native Devpost link without erasing native submission or external identity", async () => {
    const native = (await submit(await group())).json().repoId;
    const code = (await detail(native)).code;
    const url = "https://devpost.com/software/wrong-native";
    expect(await importCsv(csv(url, code))).toBe(native);
    const result = await app.inject({
      method: "POST",
      url: `/api/projects/${native}/unlink`,
      headers: asUser(admin),
      payload: { reason: "Independent projects" },
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json().externalRepoId).not.toBe(native);
    expect(await detail(native)).toMatchObject({
      devpostUrl: null,
      eligible: true,
      submittedVia: "native",
      lockReason: "native_submission",
    });
    expect(await importCsv(csv(url, code))).toBe(result.json().externalRepoId);
    expect((await detail(native)).devpostUrl).toBeNull();
  });
  it("one shared email does not merge independent projects", async () => {
    const a = await group("A"),
      b = await group("B");
    const ra = await importCsv(csv("https://devpost.com/software/a")),
      rb = await importCsv(csv("https://devpost.com/software/b"));
    expect(ra).not.toBe(rb);
    expect(
      (
        await pool.query(
          `SELECT linked_repo_id FROM planned_work_groups WHERE id=ANY($1::bigint[])`,
          [[a, b]],
        )
      ).rows.every((r) => r.linked_repo_id === null),
    ).toBe(true);
  });
  it("shows authorized planning and native link candidates as independent records", async () => {
    const planning = await group("Planning candidate");
    const native = (await submit(await group("Native candidate"))).json().repoId;
    const imported = await importCsv(csv("https://devpost.com/software/candidates"));
    const response = await app.inject({
      method: "GET",
      url: `/api/me/projects/${imported}/link-candidates`,
      headers: asUser(owner),
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: planning, kind: "group" }),
        expect.objectContaining({ id: native, kind: "repo" }),
      ]),
    );
    const stranger = await createUser();
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/me/projects/${imported}/link-candidates`,
          headers: asUser(stranger),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/projects/${imported}/link-candidates`,
          headers: asUser(admin),
        })
      ).statusCode,
    ).toBe(200);
  });
  it("links an imported record into an existing native project while retaining both prior IDs and snapshots", async () => {
    const native = (await submit(await group())).json().repoId;
    const imported = await importCsv(csv("https://devpost.com/software/a"));
    const { challengeIds } = await createEnterpriseChallenges(1);
    await enqueueRepo(challengeIds[0] as number, imported, 1);
    const result = await app.inject({
      method: "POST",
      url: `/api/me/projects/${imported}/claim`,
      headers: asUser(owner),
      payload: { targetRepoId: native },
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(
      (await pool.query(`SELECT status FROM queue_entries WHERE repo_id=$1`, [imported])).rows[0]
        .status,
    ).toBe("cancelled");
    expect(
      (
        await pool.query(
          `SELECT count(*)::int n FROM audit_log WHERE entity_type='queue_entry' AND action='reconcile_project'`,
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await pool.query(
          `SELECT count(*)::int n FROM queue_history WHERE action='reconcile_project'`,
        )
      ).rows[0].n,
    ).toBe(1);
    expect(await importCsv(csv("https://devpost.com/software/a"))).toBe(native);
    expect(
      (
        await pool.query(
          `SELECT reconciled_into_repo_id,submission_status FROM repos WHERE id=$1`,
          [imported],
        )
      ).rows[0],
    ).toMatchObject({ reconciled_into_repo_id: native, submission_status: "not_submitted" });
    const unlinked = await app.inject({
      method: "POST",
      url: `/api/projects/${native}/unlink`,
      headers: asUser(admin),
      payload: { reason: "Undo mistaken link" },
    });
    expect(unlinked.statusCode, unlinked.body).toBe(200);
    expect(unlinked.json().externalRepoId).toBe(imported);
    expect(await importCsv(csv("https://devpost.com/software/a"))).toBe(imported);
    expect(await detail(native)).toMatchObject({ eligible: true, devpostUrl: null });
  });
});

describe("event project team-size rule (H18/H21/H53)", () => {
  it("saves and resets the rule without a justification while auditing each change", async () => {
    const organizer = await createUserWithCapabilities([
      CAPABILITIES.PROJECTS_EDIT,
      CAPABILITIES.EVENT_MANAGE,
    ]);
    const initial = (await pool.query(`SELECT project_max_team_size FROM event_config WHERE id=1`))
      .rows[0];
    for (const maxTeamSize of [4, null]) {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/projects/submission-rules",
        headers: asUser(organizer),
        payload: { maxTeamSize },
      });
      expect(response.statusCode, response.body).toBe(200);
    }
    const entries = (
      await pool.query(
        `SELECT actor_id,before,after,reason,created_at FROM audit_log WHERE action='project_submission_rules' ORDER BY id`,
      )
    ).rows;
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      actor_id: organizer,
      before: initial,
      after: { project_max_team_size: 4 },
      reason: null,
    });
    expect(entries[1]).toMatchObject({
      actor_id: organizer,
      before: { project_max_team_size: 4 },
      after: { project_max_team_size: null },
      reason: null,
    });
    expect(entries.every((entry) => entry.created_at != null)).toBe(true);
    expect(
      (await pool.query(`SELECT project_max_team_size FROM event_config WHERE id=1`)).rows[0]
        .project_max_team_size,
    ).toBeNull();
  });

  it("requires both project editing and event management", async () => {
    const eventOnly = await createUserWithCapabilities([CAPABILITIES.EVENT_MANAGE]);
    for (const userId of [owner, admin, eventOnly]) {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/projects/submission-rules",
        headers: asUser(userId),
        payload: { maxTeamSize: 4 },
      });
      expect(response.statusCode).toBe(403);
    }
    expect(
      (
        await pool.query(
          `SELECT count(*)::int n FROM audit_log WHERE action='project_submission_rules'`,
        )
      ).rows[0].n,
    ).toBe(0);
  });

  it("rejects invalid limits without changing the rule or its audit", async () => {
    const organizer = await createUserWithCapabilities([
      CAPABILITIES.PROJECTS_EDIT,
      CAPABILITIES.EVENT_MANAGE,
    ]);
    for (const maxTeamSize of [0, -1, 2.5, 101]) {
      const response = await app.inject({
        method: "PATCH",
        url: "/api/projects/submission-rules",
        headers: asUser(organizer),
        payload: { maxTeamSize },
      });
      expect(response.statusCode).toBe(400);
    }
    expect(
      (
        await pool.query(
          `SELECT count(*)::int n FROM audit_log WHERE action='project_submission_rules'`,
        )
      ).rows[0].n,
    ).toBe(0);
  });
});
