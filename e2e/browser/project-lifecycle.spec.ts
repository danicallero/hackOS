import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

test("keeps one participant project before and after import, with live presentation details", async ({
  page,
}, testInfo) => {
  let imported = false;
  let multipleProjects = false;
  let firstCalled = false;
  let eligible = true;
  let staffMode = false;
  const group = {
    id: 1,
    name: "Neural Beans",
    description: "Coffee roasting with machine learning.",
    devpost_url: "https://devpost.com/software/neural-beans",
    github_url: "https://github.com/example/beans",
    demo_url: "https://beans.example.com",
    presentation_timing_preference: "early",
    presentation_timing_editable: true,
    linked_repo_id: null,
    linkedProject: null,
    members: [{ userId: 1, name: "Alex", surname: "Fernández", status: "active" }],
    challenges: [
      { id: 1, title: "Best hack", mandatory: true },
      { id: 2, title: "Climate challenge", mandatory: false },
    ],
  };
  const project = {
    id: 10,
    name: group.name,
    description: group.description,
    devpost_url: group.devpost_url,
    github_url: group.github_url,
    demo_url: group.demo_url,
    presentation_timing_preference: "early",
    members: [
      {
        userId: 1,
        name: "Alex",
        surname: "Fernández",
        email: "alex@example.test",
        mergeStatus: "auto_matched",
        matchType: "primary_email",
        devpostUsername: "alex-beans",
      },
    ],
    prizes: [],
    unmappedPrizes: [],
    challenges: [
      {
        id: 1,
        title: "Best hack",
        mandatory: true,
        status: "waiting",
        position: 2,
        etaMinutes: 968,
        assignedRoomId: null,
        assignedRoomName: null,
        rooms: [
          { id: 1, name: "Room A" },
          { id: 2, name: "Room B" },
        ],
        mappedPrizes: [],
        source: "queue",
        reviewStatus: null,
        nota: null,
      },
      {
        id: 2,
        title: "Climate challenge",
        mandatory: false,
        status: "waiting",
        position: 5,
        etaMinutes: 30,
        assignedRoomId: null,
        assignedRoomName: null,
        rooms: [
          { id: 3, name: "Room C" },
          { id: 4, name: "Room D" },
        ],
        mappedPrizes: [],
        source: "queue",
        reviewStatus: null,
        nota: null,
      },
    ],
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const currentProject = {
      ...project,
      challenges: project.challenges.map((challenge) =>
        firstCalled && challenge.id === 1
          ? {
              ...challenge,
              status: "called",
              position: null,
              etaMinutes: null,
              assignedRoomId: 1,
              assignedRoomName: "Room A",
            }
          : challenge,
      ),
    };
    const currentGroup = {
      ...group,
      linked_repo_id: imported ? 10 : null,
      presentation_timing_editable: !imported,
      linkedProject: imported ? { id: 10, name: group.name, devpostUrl: group.devpost_url } : null,
    };
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
        projects: imported
          ? multipleProjects
            ? [currentProject, { ...project, id: 11, name: "Second project", challenges: [] }]
            : [currentProject]
          : [],
        canCreate: true,
      };
    else if (path === "/api/me/work-groups") body = { groups: [currentGroup], canCreate: true };
    else if (path === "/api/me/work-groups/1") body = currentGroup;
    else if (path === "/api/me/projects/10/submission")
      body = {
        id: 10,
        name: group.name,
        code: "CODE10",
        status: "submitted",
        submittedVia: "devpost",
        submittedAt: "2026-10-09T08:00:00Z",
        eligible,
        lockedAt: null,
        devpostUrl: group.devpost_url,
        membershipDiffers: !eligible,
        unresolvedCount: eligible ? 0 : 1,
        internal: [{ userId: 1, name: "Alex", surname: "Fernández" }],
        external: eligible ? [] : [{ userId: null, name: "Dana", surname: "Review" }],
        requests: [],
        canSubmit: true,
      };
    else if (path === "/api/me/projects/invites") body = { invites: [] };
    else if (path === "/api/challenges") body = { challenges: [{ id: 1, title: "Best hack" }] };
    else if (path === "/api/public/challenges") body = { items: [{ id: 1, title: "Best hack" }] };
    else if (path === "/api/queue/me") body = [];
    else if (path === "/api/repos") body = { repos: [currentProject] };
    else if (path === "/api/repos/10") body = currentProject;
    else if (path === "/api/work-groups/estimates")
      body = {
        estimates: [
          {
            challengeId: 1,
            title: "Best hack",
            groupCount: 1,
            projectCount: 1,
            expectedCount: 1,
            participantCount: 1,
          },
        ],
      };
    else if (path.includes("notifications")) body = { items: [], total: 0 };
    if (path.endsWith("/stream")) {
      await route.fulfill({ contentType: "text/event-stream", body: "" });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/my-project");
  await expect(page).toHaveURL(/\/my-project\/work-groups\/1$/);
  const cookie = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  if (await cookie.isVisible()) await cookie.locator("button").first().click();
  await expect(page.getByRole("heading", { name: group.name, level: 1 })).toBeVisible();
  await expect(page.getByText("Alex Fernández", { exact: true })).toBeVisible();
  await expect(page.locator(`a[href="${group.github_url}"]`)).toBeVisible();
  await expect(page.getByText("Judging preference", { exact: true })).toBeVisible();
  await expect(page.getByText("Early", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete project", exact: true })).toHaveCount(0);
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
  await page.screenshot({ path: testInfo.outputPath("project-before-import.png"), fullPage: true });
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Judging preference" })).toBeEnabled();
  await page.keyboard.press("Escape");

  imported = true;
  await page.goto("/my-project/work-groups/1");
  await expect(page).toHaveURL(/\/my-project\/projects\/10$/);
  await expect(page.getByRole("heading", { name: group.name, level: 1 })).toBeVisible();
  await expect(page.getByText("Position 2", { exact: true })).toBeVisible();
  await expect(page.getByText("About 16 h 8 min", { exact: true })).toBeVisible();
  await expect(page.getByText("Room A, Room B", { exact: true })).toBeVisible();
  const firstQueue = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: "Best hack", exact: true }) });
  const secondQueue = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: "Climate challenge", exact: true }) });
  await expect(firstQueue.getByText("Position 2", { exact: true })).toBeVisible();
  await expect(firstQueue.getByText("Room A, Room B", { exact: true })).toBeVisible();
  await expect(secondQueue.getByText("Position 5", { exact: true })).toBeVisible();
  await expect(secondQueue.getByText("About 30 min", { exact: true })).toBeVisible();
  await expect(secondQueue.getByText("Room C, Room D", { exact: true })).toBeVisible();
  const firstPosition = await firstQueue.getByText("Position 2", { exact: true }).boundingBox();
  const secondPosition = await secondQueue.getByText("Position 5", { exact: true }).boundingBox();
  expect(Math.abs(firstPosition!.x - secondPosition!.x)).toBeLessThan(1);
  await expect(page.getByText("Imported project linked", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Eligible for judging", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Add code CODE10 to your Devpost submission to help match this project.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByText("CODE10", { exact: true })).toBeVisible();
  await expect(page.getByText("Reopened: edit and submit again.", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Submit without Devpost", exact: true }),
  ).toHaveCount(0);
  for (const href of [group.github_url, group.devpost_url, group.demo_url])
    await expect(page.locator(`a[href="${href}"]`)).toBeVisible();
  eligible = false;
  await page.reload();
  await expect(page.getByText("Submitted", { exact: true })).toBeVisible();
  await expect(page.getByText("Needs review", { exact: true })).toBeVisible();
  await expect(page.getByText("Participant lists differ", { exact: true })).toBeVisible();
  await expect(page.getByText("Not eligible for judging", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("project-ineligible.png"), fullPage: true });
  eligible = true;
  await page.reload();
  await expect(page.getByText("Eligible for judging", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("project-after-import.png"), fullPage: true });
  if (testInfo.project.name === "chromium") {
    await page.setViewportSize({ width: 1024, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const first = await firstQueue.getByText("Position 2", { exact: true }).boundingBox();
    const second = await secondQueue.getByText("Position 5", { exact: true }).boundingBox();
    expect(Math.abs(first!.x - second!.x)).toBeLessThan(1);
    await page.screenshot({ path: testInfo.outputPath("project-1024.png"), fullPage: true });
    await page.setViewportSize(testInfo.project.use.viewport!);
  }
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Judging preference" })).toBeDisabled();
  await page.keyboard.press("Escape");

  await page.goto("/my-project");
  await expect(page).toHaveURL(/\/my-project\/projects\/10$/);
  await page
    .getByRole("link", { name: "My projects", exact: true })
    .and(page.locator('a[href="/my-project?view=all"]'))
    .click();
  await expect(page).toHaveURL(/\/my-project\?view=all$/);
  await expect(page.getByRole("heading", { name: group.name, exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Create my project", exact: true })).toBeVisible();
  await expect(page.getByText("About 16 h 8 min", { exact: true })).toBeVisible();
  await expect(page.getByText("About 30 min", { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("participant-project-list.png"),
    fullPage: true,
  });

  multipleProjects = true;
  await page.goto("/my-project");
  await expect(page.getByRole("heading", { name: "Second project", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/my-project$/);
  await page.screenshot({
    path: testInfo.outputPath("participant-multiple-projects.png"),
    fullPage: true,
  });

  multipleProjects = false;
  firstCalled = true;
  await page.goto("/my-project");
  await expect(page).toHaveURL(/\/my-project\/projects\/10$/);
  await expect(firstQueue.getByText("Waiting at the door", { exact: true })).toBeVisible();
  await expect(firstQueue.getByText("Room A", { exact: true })).toBeVisible();
  await expect(firstQueue.getByText("About 16 h 8 min", { exact: true })).toHaveCount(0);
  await expect(secondQueue.getByText("Position 5", { exact: true })).toBeVisible();
  await expect(secondQueue.getByText("About 30 min", { exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.setItem("theme", "dark"));
  await page.reload();
  await expect(secondQueue.getByText("About 30 min", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("simultaneous-queues.png"), fullPage: true });
  await page.evaluate(() => localStorage.setItem("theme", "light"));
  await page.reload();
  await expect(secondQueue.getByText("About 30 min", { exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("simultaneous-queues-light.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(secondQueue.getByText("Room C, Room D", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath("simultaneous-queues-320.png"),
    fullPage: true,
  });
  await page.setViewportSize(testInfo.project.use.viewport!);
  firstCalled = false;

  staffMode = true;
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Challenge participation" })).toHaveCount(0);
  await expect(page.getByText("About 16 h 8 min", { exact: true })).toHaveCount(0);
  if (testInfo.project.name === "chromium") {
    const row = await page.getByRole("row").filter({ hasText: group.name }).boundingBox();
    expect(row!.height).toBeLessThan(140);
    await expect(
      page.getByRole("columnheader", { name: "Presentations", exact: true }),
    ).toHaveCount(0);
  }
  await page.screenshot({ path: testInfo.outputPath("projects-overview.png"), fullPage: true });
  await page.getByRole("link", { name: group.name, exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/10$/);
  await expect(page.getByRole("heading", { name: group.name, level: 1 })).toBeVisible();
  await expect(firstQueue.getByText("Position 2", { exact: true })).toBeVisible();
  await expect(secondQueue.getByText("Position 5", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit project", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("staff-project-detail.png"), fullPage: true });
});
