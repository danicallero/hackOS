import { mkdir } from "node:fs/promises";
import { CAPABILITIES } from "../../packages/shared/src/capabilities";
import { expect, shellUser, test } from "./fixtures";

const libraryId = "11111111-1111-4111-8111-111111111111";
const field = {
  key: "our_stack",
  kind: "library",
  library_id: libraryId,
  required: false,
  label: { en: "Technologies", es: "Tecnologías", gl: "Tecnoloxías" },
};
test("question catalogue supports inline proposals, bulk curation and confirmed field deletion", async ({
  page,
}, info) => {
  let fields: object[] = [field];
  let items = [
    { id: 1, name: "React" },
    { id: 2, name: "PostgreSQL" },
  ];
  let revision = 0;
  let responses: Record<string, unknown> = { our_stack: ["React"] };
  let deleted: string[] = [];
  await page.addInitScript(() => {
    localStorage.setItem("hackos-language", "en");
    localStorage.setItem("hackos.cookie-notice.dismissed", "true");
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (path === "/api/me/public-profile") return route.fallback();
    if (path === "/api/me")
      return route.fulfill({
        json: { ...shellUser, hasProject: true, capabilities: [CAPABILITIES.PROJECTS_EDIT] },
      });
    if (path === "/api/projects/form") {
      if (method === "PUT") {
        const body = route.request().postDataJSON();
        fields = body.template;
        deleted = body.library_deletions ?? [];
      }
      return route.fulfill({ json: { version: 1, template: fields, sections: [] } });
    }
    if (path === `/api/form-libraries/${libraryId}`) return route.fulfill({ json: { items } });
    if (path.endsWith("/proposals")) {
      const item = { id: items.length + 1, name: route.request().postDataJSON().name };
      items.push(item);
      return route.fulfill({ json: item });
    }
    if (path.endsWith("/manage")) {
      const body = route.request().postDataJSON();
      for (const rename of body.renames ?? [])
        items = items.map((item) =>
          item.id === rename.id ? { ...item, name: rename.name } : item,
        );
      items = items.filter((item) => !(body.deleteIds ?? []).includes(item.id));
      if (body.merge) items = items.filter((item) => !body.merge.sourceIds.includes(item.id));
      return route.fulfill({ json: { ok: true } });
    }
    if (path === "/api/me/projects/10/draft") {
      responses = route.request().postDataJSON().responses;
      return route.fulfill({ json: { responses, revision: ++revision } });
    }
    if (path === "/api/me/projects/10")
      return route.fulfill({
        json: {
          id: 10,
          name: "Neural Beans",
          description: "A collaborative project.",
          githubUrl: null,
          demoUrl: null,
          submissionStatus: "draft",
          canEdit: true,
          canInvite: true,
          presentationTimingPreference: "early",
          responses,
          revision,
          template: fields,
          sections: [],
          members: [{ userId: 1, name: "Alex", status: "active", photoUrl: null }],
          challenges: [],
        },
      });
    return route.fulfill({ json: { items: [], total: 0, intolerances: [], sizes: [] } });
  });
  await page.goto("/my-project/10");
  await expect(page.getByText("React", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit project", exact: true }).click();
  await page.getByRole("combobox", { name: "Technologies" }).click();
  await page.getByRole("combobox").last().fill("Rust");
  await page.getByRole("option", { name: "Add “Rust”", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect.poll(() => responses.our_stack).toEqual(["React", "Rust"]);
  await mkdir("artifacts/field-library", { recursive: true });
  await page.screenshot({
    path: `artifacts/field-library/participant-${info.project.name}.png`,
    fullPage: true,
  });
  await page.goto("/settings/event?tab=projectForm");
  await page.getByRole("button", { name: "Edit: Technologies", exact: true }).click();
  await page.getByRole("textbox", { name: "Rename: React", exact: true }).fill("React.js");
  await page.getByRole("button", { name: "Collapse question", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("unsaved changes");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Rename: React", exact: true })).toHaveValue(
    "React.js",
  );
  await page.getByRole("textbox", { name: "Rename: PostgreSQL", exact: true }).fill("Postgres");
  await page.getByRole("button", { name: "Save values", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Rename: React.js", exact: true })).toBeVisible();
  await page.screenshot({
    path: `artifacts/field-library/curation-${info.project.name}.png`,
    fullPage: true,
  });
  const manager = page.getByRole("region", { name: /Library/ });
  await manager.getByRole("checkbox", { name: "Select: React.js", exact: true }).check();
  await manager.getByRole("checkbox", { name: "Select: Rust", exact: true }).check();
  await manager.getByRole("combobox", { name: "Keep this value", exact: true }).click();
  await page.getByRole("option", { name: "Postgres", exact: true }).click();
  await manager.getByRole("button", { name: "Merge selected", exact: true }).click();
  await expect(manager.getByRole("textbox", { name: "Rename: React.js", exact: true })).toHaveCount(
    0,
  );
  await manager.getByRole("checkbox", { name: "Select: Postgres", exact: true }).check();
  await manager.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove", exact: true }).click();
  await expect(manager.getByRole("textbox", { name: "Rename: Postgres", exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("entire library");
  await page.screenshot({
    path: `artifacts/field-library/deletion-confirmation-${info.project.name}.png`,
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Search values", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await dialog.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Save questions", exact: true }).click();
  await expect.poll(() => fields.length).toBe(0);
  expect(deleted).toEqual([libraryId]);
});
