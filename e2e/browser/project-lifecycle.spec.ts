import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

test("keeps one participant project from draft to submission, with live presentation details (#1006)", async ({
  page,
}, testInfo) => {
  let submitted = false;
  let changedSinceSubmit = false;
  let multipleProjects = false;
  let firstCalled = false;
  let staffMode = false;
  const project = {
    id: 10,
    name: "Neural Beans",
    description: "Coffee roasting with machine learning.",
    github_url: "https://github.com/example/beans",
    demo_url: "https://beans.example.com",
    presentation_timing_preference: "early",
    submission_status: "draft",
    submitted_at: null as string | null,
    locked_at: null,
    members: [{ userId: 1, name: "Alex", surname: "Fernández", email: "alex@example.test" }],
    challenges: [
      { id: 1, title: "Best hack", mandatory: true },
      { id: 2, title: "Climate challenge", mandatory: false },
    ],
  };
  const queued = [
    {
      status: "waiting",
      position: 2,
      etaMinutes: 968,
      rooms: [
        { id: 1, name: "Room A" },
        { id: 2, name: "Room B" },
      ],
    },
    {
      status: "waiting",
      position: 5,
      etaMinutes: 30,
      rooms: [
        { id: 3, name: "Room C" },
        { id: 4, name: "Room D" },
      ],
    },
  ];
  function currentProject() {
    return {
      ...project,
      submission_status: submitted ? "submitted" : "draft",
      submitted_at: submitted ? "2026-10-13T08:00:00Z" : null,
      challenges: project.challenges.map((challenge, index) => {
        const queue = submitted ? queued[index] : null;
        const called = firstCalled && challenge.id === 1;
        return {
          ...challenge,
          status: called ? "called" : (queue?.status ?? null),
          position: called ? null : (queue?.position ?? null),
          etaMinutes: called ? null : (queue?.etaMinutes ?? null),
          assignedRoomId: called ? 1 : null,
          assignedRoomName: called ? "Room A" : null,
          rooms: queue?.rooms ?? [],
          reviewStatus: null,
          nota: null,
        };
      }),
    };
  }
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path === "/api/me")
      body = {
        ...shellUser,
        capabilities: staffMode
          ? [CAPABILITIES.PROJECTS_READ, CAPABILITIES.PROJECTS_EDIT]
          : [CAPABILITIES.PROJECTS_READ],
        hasProject: true,
        language: "en",
      };
    else if (path === "/api/me/projects")
      body = {
        projects: multipleProjects
          ? [
              currentProject(),
              { ...currentProject(), id: 11, name: "Second project", challenges: [] },
            ]
          : [currentProject()],
        canCreate: true,
      };
    else if (path === "/api/me/projects/10/submission")
      body = {
        id: 10,
        name: project.name,
        status: submitted ? "submitted" : "draft",
        submittedVia: submitted ? "participant" : null,
        submittedAt: submitted ? "2026-10-13T08:00:00Z" : null,
        changedSinceSubmit,
        lockedAt: null,
        lockReason: null,
        eligible: submitted,
        participantCount: 1,
        maxTeamSize: null,
        teamSizeViolation: false,
        teamSizeException: false,
        eligibilityOverride: null,
        requests: [],
        canSubmit: true,
      };
    else if (path === "/api/me/projects/invites") body = { invites: [] };
    else if (path === "/api/challenges") body = { challenges: [{ id: 1, title: "Best hack" }] };
    else if (path === "/api/public/challenges") body = { items: [{ id: 1, title: "Best hack" }] };
    else if (path === "/api/queue/me") body = [];
    else if (path === "/api/repos") body = { repos: [currentProject()] };
    else if (path === "/api/repos/10") body = currentProject();
    else if (path.includes("notifications")) body = { items: [], total: 0 };
    if (path.endsWith("/stream")) {
      await route.fulfill({ contentType: "text/event-stream", body: "" });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });

  // A single draft opens directly, with its selected challenges not yet queued.
  await page.goto("/my-project");
  await expect(page).toHaveURL(/\/my-project\/10$/);
  const cookie = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  if (await cookie.isVisible()) await cookie.locator("button").first().click();
  await expect(page.getByRole("heading", { name: project.name, level: 1 })).toBeVisible();
  await expect(page.getByText("Alex Fernández", { exact: true })).toBeVisible();
  await expect(page.locator(`a[href="${project.github_url}"]`)).toBeVisible();
  await expect(page.getByText("Judging preference", { exact: true })).toBeVisible();
  await expect(page.getByText("Early", { exact: true })).toBeVisible();
  await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  await expect(page.getByText("Planned", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit project", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "More actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Delete project", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "Delete this project" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  if (testInfo.project.name === "chromium") {
    const team = await page
      .getByRole("region", { name: "Team", exact: true })
      .getByRole("list")
      .boundingBox();
    const challenges = await page
      .getByRole("region", { name: "Challenges", exact: true })
      .getByRole("list")
      .boundingBox();
    expect(team).not.toBeNull();
    expect(challenges).not.toBeNull();
    expect(team!.x).toBeLessThan(challenges!.x);
    expect(challenges!.y).toBeLessThan(team!.y);
  }
  await page.screenshot({ path: testInfo.outputPath("project-draft.png"), fullPage: true });
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Judging preference" })).toBeEnabled();
  await page.keyboard.press("Escape");

  // Submitted and queued: editing stays open, resubmission appears only after changes.
  submitted = true;
  await page.reload();
  await expect(page.getByText("Submitted", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit again", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit project", exact: true })).toBeVisible();
  const firstQueue = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: "Best hack", exact: true }) });
  const secondQueue = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: "Climate challenge", exact: true }) });
  await expect(firstQueue.getByText("Position 2", { exact: true })).toBeVisible();
  await expect(firstQueue.getByText("Room A, Room B", { exact: true })).toBeVisible();
  await expect(firstQueue.getByText("About 16 h 8 min", { exact: true })).toBeVisible();
  await expect(secondQueue.getByText("Position 5", { exact: true })).toBeVisible();
  await expect(secondQueue.getByText("About 30 min", { exact: true })).toBeVisible();
  await expect(secondQueue.getByText("Room C, Room D", { exact: true })).toBeVisible();
  const firstPosition = await firstQueue.getByText("Position 2", { exact: true }).boundingBox();
  const secondPosition = await secondQueue.getByText("Position 5", { exact: true }).boundingBox();
  expect(Math.abs(firstPosition!.x - secondPosition!.x)).toBeLessThan(1);
  await page.screenshot({ path: testInfo.outputPath("project-submitted.png"), fullPage: true });
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Judging preference" })).toBeDisabled();
  await page.keyboard.press("Escape");

  changedSinceSubmit = true;
  await page.reload();
  await expect(page.getByText("Changes not submitted", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Submit again", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "Submit again" })).toBeVisible();
  await expect(
    page.getByText(
      "You can keep editing until the deadline. The last version you submit is the one that counts.",
    ),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("project-resubmit.png"), fullPage: true });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  changedSinceSubmit = false;

  if (testInfo.project.name === "chromium") {
    await page.setViewportSize({ width: 1024, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.setViewportSize(testInfo.project.use.viewport!);
  }

  await page
    .getByRole("link", { name: "My projects", exact: true })
    .and(page.locator('a[href="/my-project?view=all"]'))
    .click();
  await expect(page).toHaveURL(/\/my-project\?view=all$/);
  await expect(page.getByRole("heading", { name: project.name, exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Create my project", exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("participant-project-list.png"),
    fullPage: true,
  });

  multipleProjects = true;
  await page.goto("/my-project");
  await expect(page.getByRole("heading", { name: "Second project", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/my-project$/);
  multipleProjects = false;

  firstCalled = true;
  await page.goto("/my-project/10");
  await expect(firstQueue.getByText("Waiting at the door", { exact: true })).toBeVisible();
  await expect(firstQueue.getByText("Room A", { exact: true })).toBeVisible();
  await expect(secondQueue.getByText("Position 5", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(secondQueue.getByText("Room C, Room D", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("project-320.png"), fullPage: true });
  await page.setViewportSize(testInfo.project.use.viewport!);
  firstCalled = false;

  staffMode = true;
  await page.goto("/projects");
  await expect(page.getByRole("row").filter({ hasText: project.name })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("projects-overview.png"), fullPage: true });
  await page.getByRole("link", { name: project.name, exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/10$/);
  await expect(page.getByRole("heading", { name: project.name, level: 1 })).toBeVisible();
  await expect(firstQueue.getByText("Position 2", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit project", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("staff-project-detail.png"), fullPage: true });
});
