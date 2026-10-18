import { mkdir } from "node:fs/promises";
import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

const label = (en: string) => ({ en, es: en, gl: en });
const fields = [
  {
    key: "name",
    kind: "textarea",
    label: label("What did you build?"),
    required: true,
    project_description: true,
  },
];
const member = { id: 22, name: "Alex", surname: "Rivera", email: "alex@example.test" };
const challenge = {
  id: 1,
  challengeId: 1,
  title: "Best hack",
  mandatory: false,
  status: "waiting",
  position: 3,
};
const base = {
  id: 10,
  name: "Neural Beans",
  description: "Coffee roasting with machine learning.",
  submissionStatus: "submitted",
  canEdit: true,
  canSubmit: false,
  presentationTimingPreference: "early",
  responses: { name: "Coffee roasting with machine learning." },
  revision: 0,
  template: fields,
  sections: [],
  members: [{ userId: 22, name: "Alex Rivera", status: "active", photoUrl: null }],
  challenges: [challenge],
};

for (const editable of [true, false]) {
  test(`staff inspect in reading mode and edit explicitly (edit permission: ${editable})`, async ({
    page,
  }, info) => {
    let responses = { ...base.responses };
    let revision = 0;
    let created: Record<string, unknown> | null = null;
    await page.addInitScript(() => {
      localStorage.setItem("hackos-language", "en");
      localStorage.setItem("hackos.cookie-notice.dismissed", "true");
    });
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/me/public-profile") return route.fallback();
      if (path === "/api/me")
        return route.fulfill({
          json: {
            ...shellUser,
            capabilities: [
              CAPABILITIES.PROJECTS_READ,
              ...(editable ? [CAPABILITIES.PROJECTS_EDIT, CAPABILITIES.EXPORTS_RUN] : []),
            ],
          },
        });
      if (path === "/api/projects/estimates") return route.fulfill({ json: [challenge] });
      if (path === "/api/projects/form")
        return route.fulfill({ json: { version: 1, template: fields, sections: [] } });
      if (path === "/api/projects/member-candidates")
        return route.fulfill({ json: { users: [member] } });
      if (path === "/api/repos/10/draft") {
        responses = route.request().postDataJSON().responses;
        return route.fulfill({ json: { responses, revision: ++revision } });
      }
      if (path === "/api/repos/10" || path === "/api/repos/11")
        return route.fulfill({
          json: {
            ...base,
            responses,
            revision,
            id: path.endsWith("11") ? 11 : 10,
            canEdit: editable,
          },
        });
      if (path === "/api/repos") {
        if (route.request().method() === "POST") {
          created = route.request().postDataJSON();
          return route.fulfill({ json: { id: 11 } });
        }
        return route.fulfill({ json: { repos: [base] } });
      }
      return route.fulfill({ json: { items: [], unreadCount: 0 } });
    });
    await page.goto("/projects/10");
    await expect(page.getByRole("heading", { name: "Neural Beans", exact: true })).toBeVisible();
    await expect(
      page.getByText("Coffee roasting with machine learning.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "What did you build?" })).toHaveCount(0);
    await expect(page.getByText("Alex Rivera", { exact: true })).toBeVisible();
    await mkdir("artifacts/project-workspace", { recursive: true });
    await page.screenshot({
      path: `artifacts/project-workspace/inspect-${editable}-${info.project.name}.png`,
      fullPage: true,
      animations: "disabled",
    });
    if (!editable) {
      await expect(page.getByRole("button", { name: "Edit project", exact: true })).toHaveCount(0);
      return;
    }
    await page.getByRole("button", { name: "Edit project", exact: true }).click();
    const name = page.getByRole("textbox", { name: "What did you build?" });
    await name.fill("Updated project description.");
    await expect.poll(() => responses.name).toBe("Updated project description.");
    await page.screenshot({
      path: `artifacts/project-workspace/edit-${info.project.name}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "View project", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "What did you build?" })).toHaveCount(0);
    await expect(page.getByText("Updated project description.", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Manage projects", exact: true }).first().click();
    await page.getByRole("link", { name: "Neural Beans", exact: true }).click();
    await expect(page.getByText("Updated project description.", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Manage projects", exact: true }).first().click();
    await page.getByRole("button", { name: "Create project", exact: true }).click();
    const panel = page.getByRole("dialog");
    await panel.getByRole("textbox", { name: "Name", exact: true }).fill("Created for Alex");
    await panel.getByRole("combobox", { name: "Team" }).click();
    await page.keyboard.press("Escape");
    await expect(
      panel.getByText("Choose at least one team member.", { exact: true }),
    ).toBeVisible();
    await panel.getByRole("combobox", { name: "Team" }).click();
    await panel.getByPlaceholder(/Search.*name.*email/i).fill("Alex");
    await panel.getByRole("option", { name: /Alex.*Rivera/ }).click();
    await expect(panel.getByRole("link", { name: "Neural Beans", exact: true })).toBeVisible();
    await panel
      .getByRole("textbox", { name: "What did you build?" })
      .fill("Created on behalf of the selected team.");
    await page.evaluate(() => document.fonts.ready);
    await expect(panel.getByRole("textbox", { name: "Name", exact: true })).toHaveValue(
      "Created for Alex",
    );
    await page.screenshot({
      path: `artifacts/project-workspace/create-${info.project.name}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await panel.getByRole("button", { name: "Create project", exact: true }).click();
    await expect
      .poll(() => created)
      .toMatchObject({
        name: "Created for Alex",
        memberUserIds: [22],
        responses: { name: "Created on behalf of the selected team." },
      });
    await expect(page).toHaveURL(/\/projects\/11$/);
    await expect(page.getByRole("textbox", { name: "What did you build?" })).toHaveCount(0);
  });
}

test("submitted participants are frozen until they withdraw, then edit and submit again (H20, H21)", async ({
  page,
}, info) => {
  let responses = { ...base.responses };
  let revision = 0;
  let status = "submitted";
  let submissions = 0;
  await page.addInitScript(() => {
    localStorage.setItem("hackos-language", "en");
    localStorage.setItem("hackos.cookie-notice.dismissed", "true");
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me/public-profile") return route.fallback();
    if (path === "/api/me")
      return route.fulfill({ json: { ...shellUser, capabilities: [], hasProject: true } });
    if (path === "/api/me/projects/10")
      return route.fulfill({
        json: {
          ...base,
          isMember: true,
          submissionStatus: status,
          canEdit: status === "draft",
          canSubmit: status === "draft",
          canWithdraw: status === "submitted",
          responses,
          revision,
        },
      });
    if (path.endsWith("/draft")) {
      responses = route.request().postDataJSON().responses;
      return route.fulfill({ json: { responses, revision: ++revision } });
    }
    if (path.endsWith("/withdraw-submission")) {
      status = "draft";
      return route.fulfill({ json: { submissionStatus: "draft" } });
    }
    if (path.endsWith("/submit")) {
      submissions++;
      status = "submitted";
      return route.fulfill({ json: { submissionStatus: "submitted" } });
    }
    return route.fulfill({ json: { items: [], unreadCount: 0 } });
  });
  await page.goto("/my-project/10");
  await expect(page.getByRole("textbox", { name: "What did you build?" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit project", exact: true })).toHaveCount(0);
  await mkdir("artifacts/project-workspace", { recursive: true });
  await page.screenshot({
    path: `artifacts/project-workspace/submitted-${info.project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Withdraw submission to edit", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Withdraw submission to edit", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "What did you build?" })).toBeVisible();
  await page
    .getByRole("textbox", { name: "What did you build?" })
    .fill("Changes after withdrawing.");
  await expect.poll(() => responses.name).toBe("Changes after withdrawing.");
  await page.getByRole("button", { name: "Submit project", exact: true }).click();
  await expect.poll(() => submissions).toBe(1);
  await expect(
    page.getByRole("button", { name: "Withdraw submission to edit", exact: true }),
  ).toBeVisible();
});

test("a complete draft offers Submit project beside Edit project in reading mode (H20)", async ({
  page,
}, info) => {
  let submissions = 0;
  await page.addInitScript(() => {
    localStorage.setItem("hackos-language", "en");
    localStorage.setItem("hackos.cookie-notice.dismissed", "true");
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me/public-profile") return route.fallback();
    if (path === "/api/me")
      return route.fulfill({ json: { ...shellUser, capabilities: [], hasProject: true } });
    if (path === "/api/me/projects/10")
      return route.fulfill({
        json: {
          ...base,
          isMember: true,
          submissionStatus: submissions ? "submitted" : "draft",
          canEdit: !submissions,
          canSubmit: !submissions,
        },
      });
    if (path.endsWith("/draft"))
      return route.fulfill({ json: { responses: base.responses, revision: 1 } });
    if (path.endsWith("/submit")) {
      submissions++;
      return route.fulfill({ json: { submissionStatus: "submitted" } });
    }
    return route.fulfill({ json: { items: [], unreadCount: 0 } });
  });
  await page.goto("/my-project/10");
  const submit = page.getByRole("button", { name: "Submit project", exact: true });
  const edit = page.getByRole("button", { name: "Edit project", exact: true });
  await expect(submit).toBeVisible();
  await expect(edit).toBeVisible();
  const [submitBox, editBox] = [await submit.boundingBox(), await edit.boundingBox()];
  expect(submitBox?.x).toBeLessThan(editBox?.x ?? 0);
  await mkdir("artifacts/project-workspace", { recursive: true });
  await page.screenshot({
    path: `artifacts/project-workspace/draft-actions-${info.project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  await submit.click();
  await expect.poll(() => submissions).toBe(1);
  await expect(submit).toHaveCount(0);
});
