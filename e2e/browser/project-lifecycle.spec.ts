import { mkdir } from "node:fs/promises";
import { expect, shellUser, test } from "./fixtures";

const project = {
  id: 10,
  name: "Neural Beans",
  description: "",
  githubUrl: null,
  demoUrl: null,
  submissionStatus: "draft",
  canEdit: true,
  presentationTimingPreference: "early",
  responses: {},
  revision: 0,
  formVersion: 1,
  template: [
    {
      key: "summary",
      label: { en: "What did you build?", es: "Que construiste?", gl: "Que construíches?" },
      kind: "textarea",
      required: true,
    },
  ],
  sections: [],
  members: [{ userId: 1, name: "Alex", status: "active", photoUrl: null }],
  challenges: [{ id: 1, title: "Best hack", mandatory: true }],
};
test("native draft autosaves, validates and submits at desktop and narrow widths", async ({
  page,
}, info) => {
  let revision = 0;
  let responses: Record<string, unknown> = {};
  await page.addInitScript(() => {
    localStorage.setItem("hackos-language", "en");
    localStorage.setItem("hackos-cookie-consent", "accepted");
  });
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { ...shellUser, hasProject: true } }),
  );
  await page.route("**/api/me/notifications**", (route) =>
    route.fulfill({ json: { items: [], unreadCount: 0 } }),
  );
  await page.route("**/api/me/projects/10", (route) =>
    route.fulfill({ json: { ...project, revision, responses } }),
  );
  await page.route("**/api/me/projects/10/draft", (route) => {
    const body = route.request().postDataJSON();
    expect(body.revision).toBe(revision);
    responses = body.responses;
    revision += 1;
    return route.fulfill({ json: { responses, revision } });
  });
  await page.route("**/api/me/projects/10/submit", (route) =>
    route.fulfill({ json: { id: 10, submissionStatus: "submitted" } }),
  );
  await page.route("**/api/public/challenges", (route) =>
    route.fulfill({ json: { items: project.challenges } }),
  );
  await page.route("**/api/me/project-gallery-consent", (route) =>
    route.fulfill({ json: { showName: true, showPhoto: false } }),
  );
  await page.goto("/my-project/10");
  const cookies = page.locator('aside[aria-labelledby="cookie-notice-title"]');
  if (await cookies.isVisible()) await cookies.locator("button").first().click();
  await expect(page.getByRole("heading", { name: "Neural Beans" })).toBeVisible();
  await page.getByRole("button", { name: "Submit project" }).click();
  await expect(page.getByText("This field is required", { exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: "What did you build?" })
    .fill("Coffee roasting with machine learning.");
  await expect.poll(() => responses.summary).toBe("Coffee roasting with machine learning.");
  await page.getByRole("button", { name: "Submit project" }).click();
  await expect(page.getByText("Submitted", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await mkdir("/tmp/hackos-1011-screenshots", { recursive: true });
  await page.screenshot({
    path: `/tmp/hackos-1011-screenshots/project-${info.project.name}.png`,
    fullPage: true,
  });
});

test("project name save failure stays dirty, retries and blank names are not sent", async ({
  page,
}, info) => {
  let failing = true;
  const patches: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("hackos-language", "en");
    localStorage.setItem("hackos.cookie-notice.dismissed", "true");
  });
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { ...shellUser, hasProject: true } }),
  );
  await page.route("**/api/me/projects/10", (route) => {
    if (route.request().method() === "PATCH") {
      patches.push(route.request().postDataJSON().name);
      if (failing)
        return route.fulfill({
          status: 500,
          json: { error: { code: "internal", message: "Boom" } },
        });
      return route.fulfill({ json: { ...project, name: patches.at(-1) } });
    }
    return route.fulfill({ json: project });
  });
  await page.route("**/api/public/challenges", (route) =>
    route.fulfill({ json: { items: project.challenges } }),
  );
  await page.route("**/api/me/project-gallery-consent", (route) =>
    route.fulfill({ json: { showName: true, showPhoto: false } }),
  );
  await page.route("**/api/me/notifications**", (route) =>
    route.fulfill({ json: { items: [], unreadCount: 0 } }),
  );
  await page.goto("/my-project/10");
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  await name.fill("   ");
  await name.blur();
  await expect(name).toHaveValue("Neural Beans");
  expect(patches).toEqual([]);
  await name.fill("Neural Espresso");
  await name.blur();
  await expect(page.getByText("Something went wrong on our side", { exact: false })).toBeVisible();
  await expect(name).toHaveValue("Neural Espresso");
  await mkdir("/tmp/hackos-1011-screenshots", { recursive: true });
  await page.screenshot({
    path: `/tmp/hackos-1011-screenshots/project-name-error-${info.project.name}.png`,
  });
  failing = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Something went wrong on our side", { exact: false })).toHaveCount(0);
  expect(patches).toEqual(["Neural Espresso", "Neural Espresso"]);
  await mkdir("/tmp/hackos-1011-screenshots", { recursive: true });
  await page.screenshot({
    path: `/tmp/hackos-1011-screenshots/project-name-${info.project.name}.png`,
    fullPage: true,
  });
});
