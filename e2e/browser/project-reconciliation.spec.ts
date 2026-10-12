import type { ProjectSubmission } from "../../apps/web/src/lib/projects";
import webEs from "../../packages/shared/locales/es/web.json" with { type: "json" };
import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

const alice = { userId: 12, name: "Alice", surname: "Review", email: "alice@example.test" };
const bob = { userId: 13, name: "Bob", surname: "Review", email: "bob@example.test" };
function project(
  id: number,
  name: string,
  overrides: Partial<ProjectSubmission> = {},
): ProjectSubmission {
  return {
    id,
    name,
    code: `CODE${id}ABC`,
    status: "submitted",
    submittedVia: "native",
    submittedAt: "2026-10-08T12:00:00Z",
    lockedAt: "2026-10-08T12:00:00Z",
    lockReason: "native_submission",
    devpostUrl: null,
    eligible: true,
    membershipDiffers: false,
    membershipResolution: null,
    unresolvedCount: 0,
    participantCount: 2,
    maxTeamSize: 4,
    teamSizeViolation: false,
    teamSizeException: false,
    eligibilityOverride: null,
    internal: [alice, bob],
    external: [],
    requests: [],
    canSubmit: false,
    ...overrides,
  };
}
const projects = [
  project(1, "Water AI", {
    requests: [
      {
        id: 1,
        reason: "Correct the demonstration URL before judging starts.",
        status: "pending",
        created_at: "2026-10-08T12:00:00Z",
        decision_reason: null,
      },
    ],
  }),
  project(2, "Climate sensors for cities and local communities", {
    devpostUrl: "https://devpost.com/software/climate",
    membershipDiffers: true,
    unresolvedCount: 1,
    eligible: false,
    external: [
      alice,
      {
        userId: null,
        name: "Dana",
        surname: "Review",
        email: "dana.with.a.long.address@example.test",
      },
    ],
  }),
  project(3, "Team Atlas", { teamSizeViolation: true, participantCount: 5, eligible: false }),
  project(4, "Devpost only", {
    devpostUrl: "https://devpost.com/software/only",
    submittedVia: "devpost",
    internal: [],
    external: [alice, bob],
  }),
  project(5, "Native submission", {}),
];

async function noOverflow(page: import("@playwright/test").Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}

test("reconciliation reuses list filters and responsive project review", async ({
  page,
}, testInfo) => {
  let approval: unknown = null;
  let ruleSave: unknown = null;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = { items: [], groups: [], total: 0 };
    if (path === "/api/me") body = { ...shellUser, capabilities: [CAPABILITIES.ADMIN_ALL] };
    if (path === "/api/projects/reconciliation")
      body = {
        projects,
        planned: [
          { id: 1, name: "Draft planning project", code: "DRAFT123", status: "draft" },
          { id: 2, name: "Project not submitted", code: "MISSED12", status: "not_submitted" },
        ],
        config: { maxTeamSize: 4, deadline: "2026-10-08T18:00:00Z" },
      };
    if (path === "/api/projects/submission-rules") {
      ruleSave = route.request().postDataJSON();
      body = { saved: true };
    }
    if (path === "/api/projects/1/unlock") {
      approval = route.request().postDataJSON();
      body = { approved: true };
    }
    if (path === "/api/events/stream") {
      await route.fulfill({ contentType: "text/event-stream", body: ": ready\n\n" });
      return;
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/projects/reconciliation");
  await expect(page.getByRole("button", { name: "Water AI", exact: true })).toBeVisible();
  const cookie = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  if (await cookie.isVisible()) await cookie.locator("button").first().click();
  const search = page.getByRole("searchbox");
  const filters = page.getByRole("button", { name: /^Filters/ });
  const rules = page.getByRole("menuitem", { name: "Submission rules", exact: true });
  for (const control of [filters]) {
    const a = await search.boundingBox(),
      b = await control.boundingBox();
    expect(a && b && Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  }
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("reconciliation-list.png"), fullPage: true });
  await page
    .locator("[data-page-layout] > header")
    .getByRole("button", { name: "More actions", exact: true })
    .click();
  await rules.click();
  const rulesPanel = page.getByRole("dialog");
  await expect(rulesPanel.getByLabel("Reason", { exact: true })).toHaveCount(0);
  await rulesPanel.getByLabel("Maximum team size (optional)", { exact: true }).fill("6");
  await rulesPanel.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  await page.screenshot({ path: testInfo.outputPath("admin-submission-rules.png") });
  await rulesPanel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(ruleSave).toEqual({ maxTeamSize: 6 });
  await search.fill("CODE2");
  await expect(page.getByRole("button", { name: "Water AI", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: projects[1]!.name, exact: true })).toBeVisible();
  await search.fill("");
  await filters.click();
  await page.getByRole("menuitem", { name: "Submission", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: "In this platform", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: projects[1]!.name, exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Remove Submission: In this platform", exact: true })
    .click();
  await page.getByRole("button", { name: projects[1]!.name, exact: true }).click();
  const review = page.getByRole("dialog");
  await expect(review.getByText("Participant lists differ", { exact: true })).toBeVisible();
  await review.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("reconciliation-review.png") });
  await review.getByRole("button", { name: "More actions", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Unlink Devpost", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Water AI", exact: true }).click();
  await page.getByRole("button", { name: "Approve edits", exact: true }).click();
  const decision = page.getByRole("alertdialog");
  await expect(decision.getByRole("button", { name: "Approve edits", exact: true })).toBeDisabled();
  await decision.getByLabel("Reason", { exact: true }).fill("Allow the correction before judging.");
  await decision.getByRole("button", { name: "Approve edits", exact: true }).click();
  await expect
    .poll(() => approval)
    .toEqual({ decision: "approve", reason: "Allow the correction before judging." });
  expect(errors).toEqual([]);
});

test("participant submission actions stay aligned with their section", async ({
  page,
}, testInfo) => {
  const state = project(1, "Water AI");
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = { items: [], groups: [] };
    if (path === "/api/me") body = { ...shellUser, id: 12, capabilities: [], hasProject: true };
    if (path === "/api/me/projects")
      body = {
        projects: [
          {
            id: 1,
            name: "Water AI",
            description: "A water quality monitor for local communities.",
            github_url: "https://github.com/example/water",
            devpost_url: null,
            demo_url: null,
            members: [
              { ...alice, status: "active" },
              { ...bob, status: "active" },
            ],
            prizes: [],
            unmappedPrizes: [],
            challenges: [],
            locked_at: state.lockedAt,
            reconciliation_code: state.code,
            presentation_timing_preference: "late",
          },
        ],
        canCreate: true,
      };
    if (path === "/api/me/projects/1/submission") body = state;
    if (path.includes("/stream")) {
      await route.fulfill({ contentType: "text/event-stream", body: ": ready\n\n" });
      return;
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/my-project/projects/1");
  await expect(page.getByRole("button", { name: "Request edits", exact: true })).toBeVisible();
  const cookie = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  if (await cookie.isVisible()) await cookie.locator("button").first().click();
  const section = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Submission", exact: true }) });
  await expect(section.getByRole("button", { name: "Request edits", exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("participant-submitted.png"), fullPage: true });
  await page.getByRole("button", { name: "Request edits", exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("Reason", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Request edits", exact: true })).toBeFocused();
});

test("track timing belongs beside pacing and aligns its translated fields", async ({
  page,
}, testInfo) => {
  let timingSave: unknown = null;
  const room = { id: 7, name: "Room Alpha", slug: "alpha", status: "active" };
  const challenge = { id: 41, title: "Water track", judging_panel_criteria: [] };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = [];
    if (path === "/api/me")
      body = { ...shellUser, capabilities: [CAPABILITIES.QUEUE_ADMIN, CAPABILITIES.JUDGE_PANEL] };
    if (path === "/api/challenges") body = { challenges: [challenge] };
    if (path === "/api/queue/rooms") body = [room];
    if (path.endsWith("/view"))
      body = {
        room,
        challenge,
        state: { room_id: 7, is_paused: false, desired_minutes_per_team: 8 },
        active: null,
        called: [],
        next: [],
        crossRoomSkips: [],
      };
    if (path.endsWith("/pace"))
      body = {
        roomId: 7,
        desiredMinutesPerTeam: 8,
        challengeMaxMinutes: null,
        roomCount: 1,
        pendingCount: 0,
        remainingMinutes: 2,
        requiredMinutes: 12,
        estimatedCycleMinutes: 14,
        estimatedFinishAt: new Date(Date.now() + 12 * 60000).toISOString(),
        judgingClosesAt: new Date(Date.now() + 2 * 60000).toISOString(),
        exceedsJudgingClose: true,
        insufficientTime: true,
        suggestedMinutesPerTeam: 1,
        autoAdjusted: true,
        effectiveMinutesPerTeam: 1,
        calledTooLongThresholdMinutes: 15,
      };
    if (path.endsWith("/progress"))
      body = {
        challengeId: 41,
        waiting: 0,
        called: 0,
        inProgress: 1,
        evaluated: 5,
        disqualified: 0,
        other: 0,
        avgEvaluationMinutes: 12,
      };
    if (path.endsWith("/timing")) {
      if (route.request().method() === "PATCH") timingSave = route.request().postDataJSON();
      body = {
        targetSeconds: 480,
        preparationSeconds: 120,
        target_minutes: "8",
        estimated_cycle_minutes: "14",
        sample_count: "5",
        observed_presentation_minutes: "12",
        observed_preparation_minutes: "3",
      };
    }
    if (path.includes("/stream")) {
      await route.fulfill({ contentType: "text/event-stream", body: ": ready\n\n" });
      return;
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/judging");
  await expect(page.getByRole("button", { name: "Track timing", exact: true })).toBeVisible();
  const cookie = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  if (await cookie.isVisible()) await cookie.locator("button").first().click();
  await expect(
    page.getByText("Estimated finish exceeds judging close", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Judging closes", { exact: true })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("judging-pacing.png"), fullPage: true });
  await page.getByRole("button", { name: "Track timing", exact: true }).click();
  const editor = page.getByRole("dialog");
  const target = editor.getByLabel("Target presentation minutes per team", { exact: true });
  const setup = editor.getByLabel("Minutes to enter and prepare", { exact: true });
  await expect(target).toHaveValue("8");
  await editor.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  const a = await target.boundingBox(),
    b = await setup.boundingBox();
  if (page.viewportSize()!.width >= 640)
    expect(a && b && Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("track-timing-editor.png") });
  await target.fill("6");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => timingSave).toEqual({ targetSeconds: 360, preparationSeconds: 120 });
  await expect(page.getByRole("button", { name: "Track timing", exact: true })).toBeFocused();
});

test("Spanish reconciliation labels and decisions fit the shared list layout", async ({
  page,
}, testInfo) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = { items: [], groups: [] };
    if (path === "/api/me")
      body = { ...shellUser, language: "es", capabilities: [CAPABILITIES.ADMIN_ALL] };
    if (path === "/api/projects/reconciliation")
      body = {
        projects,
        planned: [],
        config: { maxTeamSize: 4, deadline: "2026-10-08T18:00:00Z" },
      };
    if (path.includes("/stream")) {
      await route.fulfill({ contentType: "text/event-stream", body: ": ready\n\n" });
      return;
    }
    await route.fulfill({ json: body });
  });
  await page.goto("/projects/reconciliation");
  await expect(
    page.getByRole("heading", { name: webEs.projectReconciliation, exact: true }),
  ).toBeVisible();
  const cookie = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  if (await cookie.isVisible()) await cookie.locator("button").first().click();
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath("reconciliation-spanish-list.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: projects[1]!.name, exact: true }).click();
  const review = page.getByRole("dialog");
  await expect(
    review.getByRole("button", { name: webEs.projectUseInternal, exact: true }),
  ).toBeVisible();
  await review.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  await noOverflow(page);
  const actions = await review
    .getByRole("button", { name: webEs.moreActions, exact: true })
    .boundingBox();
  expect(actions && actions.y + actions.height).toBeLessThanOrEqual(
    page.viewportSize()!.height - 8,
  );
  await page.screenshot({ path: testInfo.outputPath("reconciliation-spanish-review.png") });
});

for (const origin of ["project", "group"] as const) {
  test(`Spanish ${origin} draft keeps header actions inline and groups the participant workflow`, async ({
    page,
  }, testInfo) => {
    const name = origin === "group" ? "Sensores de agua para comunidades locales" : "Water AI";
    const selected = { id: 9, title: "Agua y sostenibilidad", mandatory: false };
    const catalogue = [selected, { id: 10, title: "Innovación abierta", mandatory: false }];
    const state = project(1, name, {
      status: "draft",
      eligible: false,
      submittedVia: null,
      submittedAt: null,
      lockedAt: null,
      lockReason: null,
      canSubmit: true,
    });
    const group = {
      id: 8,
      name,
      description: "Monitorización del agua para comunidades locales.",
      github_url: "https://github.com/example/water",
      demo_url: null,
      devpost_url: null,
      presentation_timing_preference: "late",
      presentation_timing_editable: true,
      linked_repo_id: origin === "project" ? 1 : null,
      linkedProject: null,
      reconciliation_code: "K7M4Q",
      can_submit: true,
      members: [
        { ...alice, status: "active" },
        { ...bob, status: "active" },
      ],
      challenges: [selected],
    };
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body: unknown = { items: [], groups: [] };
      if (path === "/api/queue/me") body = [];
      if (path === "/api/me")
        body = { ...shellUser, id: 12, language: "es", capabilities: [], hasProject: true };
      if (path === "/api/me/projects")
        body = {
          projects: [
            {
              ...group,
              id: 1,
              locked_at: null,
              prizes: [],
              unmappedPrizes: [],
              challenges: [{ ...selected, status: null }],
            },
          ],
          canCreate: true,
        };
      if (path === "/api/me/projects/1/submission") body = state;
      if (path === "/api/me/work-groups") body = { groups: [], canCreate: true };
      if (path === "/api/me/work-groups/8") body = group;
      if (path === "/api/public/challenges") body = { items: catalogue };
      if (path.includes("/stream")) {
        await route.fulfill({ contentType: "text/event-stream", body: ": ready\n\n" });
        return;
      }
      await route.fulfill({ json: body });
    });
    await page.goto(origin === "project" ? "/my-project/projects/1" : "/my-project/work-groups/8");
    const header = page.locator('[data-page-layout="content"] > header');
    await expect(header.getByRole("heading", { name, exact: true })).toBeVisible();
    const edit = header.getByRole("button", { name: webEs.editProject, exact: true });
    const back = header.getByRole("link", { name: webEs.myProjects, exact: true });
    await expect(edit).toBeVisible();
    await expect(back).toBeVisible();
    if (testInfo.project.name === "mobile-chromium") {
      const geometry = await edit.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return {
          width: box.width,
          height: box.height,
          radius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius),
        };
      });
      expect(geometry.width).toBe(geometry.height);
      expect(geometry.radius).toBeGreaterThanOrEqual(geometry.width / 2);
    }
    const titleBox = await header.getByRole("heading").boundingBox();
    for (const control of [edit, back]) {
      const box = await control.boundingBox();
      expect(
        titleBox && box && Math.abs(titleBox.y + titleBox.height / 2 - box.y - box.height / 2),
      ).toBeLessThanOrEqual(8);
    }
    const sections = page.locator('[data-page-layout="content"] section');
    await expect(sections.locator("h2")).toHaveText([
      webEs.projectDetailsTitle,
      webEs.teamSectionTitle,
      webEs.challenges,
      webEs.projectSubmission,
    ]);
    await expect(
      sections.nth(2).getByText(webEs.workGroupTimingLate, { exact: true }),
    ).toBeVisible();
    const cookie = page.locator('aside[aria-labelledby="cookie-notice-title"]');
    if (await cookie.isVisible()) await cookie.locator("button").first().click();
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`participant-${origin}-draft.png`),
      fullPage: true,
    });
    if (testInfo.project.name === "mobile-chromium") {
      await page.setViewportSize({ width: 320, height: 800 });
      await noOverflow(page);
      const narrowTitle = await header.getByRole("heading").boundingBox();
      for (const control of [edit, back]) {
        const box = await control.boundingBox();
        expect(
          narrowTitle &&
            box &&
            Math.abs(narrowTitle.y + narrowTitle.height / 2 - box.y - box.height / 2),
        ).toBeLessThanOrEqual(8);
      }
      await page.screenshot({
        path: testInfo.outputPath(`participant-${origin}-draft-320.png`),
        fullPage: true,
      });
    }
    await edit.click();
    await expect(
      page.getByRole("dialog").getByRole("heading", { name: webEs.editProject, exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(edit).toBeFocused();
    await sections.nth(2).getByRole("button", { name: webEs.addChallenge, exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("combobox")).toBeVisible();
    await noOverflow(page);
    await page.keyboard.press("Escape");
    await sections
      .nth(3)
      .getByRole("button", { name: webEs.submitProjectNative, exact: true })
      .click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await back.click();
    await expect(page).toHaveURL(/\/my-project\?view=all$/);
  });
}
