import { mkdir } from "node:fs/promises";
import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

const label = (en: string) => ({ en, es: en, gl: en });
const sections = [
  { key: "story", title: label("The project") },
  { key: "tech", title: label("Technology & experience") },
  { key: "demo", title: label("See it in action") },
];
const template = [
  {
    key: "our_story",
    label: label("What did you build?"),
    kind: "textarea",
    required: true,
    project_description: true,
    section_key: "story",
  },
  {
    key: "problem",
    label: label("The problem we wanted to solve"),
    kind: "textarea",
    required: true,
    section_key: "story",
  },
  {
    key: "stack",
    label: label("Built with"),
    kind: "multiselect",
    required: true,
    section_key: "tech",
    options: ["TypeScript", "Python", "PostgreSQL", "Gemini", "OpenAI"].map((value) => ({
      value,
      label: label(value),
    })),
  },
  {
    key: "learning",
    label: label("What did you learn along the way?"),
    kind: "textarea",
    required: false,
    section_key: "tech",
    help_text: label("Mention the technologies you tried and what worked well for your team."),
  },
  {
    key: "repo",
    label: label("Public code repository"),
    kind: "text",
    required: true,
    section_key: "demo",
    validation: { text_condition: "url" },
  },
  {
    key: "film",
    label: label("Project walkthrough"),
    kind: "text",
    required: false,
    section_key: "demo",
    project_video: true,
  },
];
const project = {
  id: 10,
  name: "Neural Beans",
  description: "Coffee roasting with machine learning.",
  githubUrl: null,
  demoUrl: null,
  submissionStatus: "draft",
  canEdit: true,
  canSubmit: true,
  canInvite: true,
  presentationTimingPreference: "early",
  revision: 0,
  formVersion: 1,
  template,
  sections,
  responses: {
    our_story: "Coffee roasting with machine learning.",
    problem: "Small roasters need reliable tools to reduce waste and get consistent results.",
    stack: ["TypeScript", "Python", "PostgreSQL"],
    learning: "We built a sensor pipeline and learned how to train models on small datasets.",
    repo: "https://github.com/example/neural-beans",
    film: "https://youtu.be/abcdefghijk",
  },
  members: ["Alex Rivera", "Sam Costa", "Noa Silva", "Dani Fernández"].map((name, index) => ({
    userId: index + 1,
    name,
    status: "active",
    photoUrl: null,
  })),
  challenges: ["Best hack", "Social impact", "Open technology"].map((title, index) => ({
    id: index + 1,
    title,
    mandatory: index === 0,
  })),
};

test("dynamic project editor and question builder stay readable with a full form", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    localStorage.setItem("hackos-language", "en");
    localStorage.setItem("hackos.cookie-notice.dismissed", "true");
  });
  let saved: { template: { key: string; project_video?: boolean }[] } | null = null;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me/public-profile") return route.fallback();
    if (path === "/api/me")
      return route.fulfill({
        json: { ...shellUser, hasProject: true, capabilities: [CAPABILITIES.PROJECTS_EDIT] },
      });
    if (path === "/api/me/projects/10") return route.fulfill({ json: project });
    if (path === "/api/projects/form") {
      if (route.request().method() === "PUT") saved = route.request().postDataJSON();
      return route.fulfill({ json: { version: 1, template, sections, ...saved } });
    }
    if (path === "/api/public/challenges")
      return route.fulfill({ json: { items: project.challenges } });
    return route.fulfill({ json: { items: [], total: 0, intolerances: [], sizes: [] } });
  });
  const screenshots = "artifacts/submission-portal";
  await mkdir(screenshots, { recursive: true });
  await page.goto("/my-project/10");
  await expect(page.getByRole("heading", { name: "Neural Beans", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The project", exact: true })).toBeVisible();
  await page.screenshot({ path: `${screenshots}/read-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  await expect(page.getByRole("button", { name: "Play video: Project walkthrough" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => localStorage.setItem("theme", theme), theme);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /light/);
    await expect(page.getByRole("heading", { name: "Neural Beans", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Edit project", exact: true }).click();
    await page.screenshot({
      path: `${screenshots}/editor-${theme}-${info.project.name}.png`,
      fullPage: true,
    });
    await page.screenshot({
      path: `${screenshots}/editor-viewport-${theme}-${info.project.name}.png`,
    });
  }
  await page.goto("/settings/event?tab=projectForm");
  await expect(page.getByRole("heading", { name: "Form fields", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit: Project walkthrough" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => localStorage.setItem("theme", theme), theme);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /light/);
    await page.getByRole("button", { name: "Edit: Project walkthrough" }).click();
    await page.screenshot({
      path: `${screenshots}/builder-${theme}-${info.project.name}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "More options", exact: true }).click();
  const video = page.getByRole("menuitemcheckbox", { name: "YouTube video", exact: true });
  await expect(video).toBeChecked();
  await video.click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Save questions", exact: true }).click();
  await expect.poll(() => saved?.template.length).toBe(template.length);
  expect(saved?.template.find((field) => field.key === "film")?.project_video).toBeUndefined();
});
