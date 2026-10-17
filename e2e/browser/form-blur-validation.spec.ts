import { mkdir } from "node:fs/promises";
import { expect, shellUser, test } from "./fixtures";

// H11/H12/H20: feedback must be available before pressing Submit.
test("project fields validate on blur, including phones and required consent", async ({
  page,
}, info) => {
  const label = (en: string) => ({ en, es: en, gl: en });
  let submitted = 0;
  let revision = 0;
  await page.addInitScript(() => {
    localStorage.setItem("hackos-language", "en");
    localStorage.setItem("hackos.cookie-notice.dismissed", "true");
  });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/me/public-profile") return route.fallback();
    if (path === "/api/me") return route.fulfill({ json: { ...shellUser, hasProject: true } });
    if (path === "/api/me/projects/10")
      return route.fulfill({
        json: {
          id: 10,
          name: "Blur validation",
          description: "",
          submissionStatus: "draft",
          canEdit: true,
          responses: {},
          revision: 0,
          formVersion: 1,
          sections: [],
          members: [],
          challenges: [],
          template: [
            { key: "phone", label: label("Phone"), kind: "phone", required: true },
            {
              key: "email",
              label: label("Contact email"),
              kind: "text",
              required: true,
              validation: { text_condition: "email" },
            },
            {
              key: "track",
              label: label("Track"),
              kind: "select",
              required: true,
              options: [{ value: "web", label: label("Web") }],
            },
            {
              key: "tools",
              label: label("Tools"),
              kind: "multiselect",
              required: true,
              options: [{ value: "ts", label: label("TypeScript") }],
            },
            { key: "consent", label: label("I agree"), kind: "checkbox", required: true },
            {
              key: "summary",
              label: label("Summary"),
              kind: "textarea",
              required: true,
              validation: { min_length: 10 },
            },
          ],
        },
      });
    if (path.endsWith("/draft"))
      return route.fulfill({
        json: { responses: route.request().postDataJSON().responses, revision: ++revision },
      });
    if (path.endsWith("/submit")) {
      submitted++;
      return route.fulfill({ json: { submissionStatus: "submitted" } });
    }
    return route.fulfill({ json: { items: [] } });
  });
  await page.goto("/my-project/10");
  const phone = page.getByRole("textbox", { name: "Phone", exact: false });
  await phone.fill("123");
  await expect(phone).not.toHaveAttribute("aria-invalid", "true");
  await phone.blur();
  await expect(phone).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("alert").filter({ hasText: "phone" })).toContainText("phone");
  await mkdir("artifacts/form-validation", { recursive: true });
  await page.screenshot({
    path: `artifacts/form-validation/phone-${info.project.name}.png`,
    fullPage: true,
  });
  await phone.fill("600111222");
  await phone.blur();
  await expect(phone).toHaveValue("+34 600 11 12 22");
  await expect(phone).not.toHaveAttribute("aria-invalid", "true");
  const email = page.getByRole("textbox", { name: "Contact email" });
  await email.fill("broken");
  await email.blur();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  const track = page.getByRole("combobox", { name: "Track" });
  await track.focus();
  await track.blur();
  await expect(track).toHaveAttribute("aria-invalid", "true");
  await track.click();
  await page.getByRole("option", { name: "Web", exact: true }).click();
  await expect(track).not.toHaveAttribute("aria-invalid", "true");
  const tools = page.getByRole("combobox", { name: "Tools" });
  await tools.focus();
  await tools.blur();
  await expect(tools).toHaveAttribute("aria-invalid", "true");
  await tools.click();
  await page.getByRole("option", { name: "TypeScript" }).click();
  await page.keyboard.press("Escape");
  await expect(tools).not.toHaveAttribute("aria-invalid", "true");
  const consent = page.getByRole("checkbox", { name: "I agree" });
  await consent.focus();
  await consent.blur();
  await expect(consent).toHaveAttribute("aria-invalid", "true");
  const summary = page.getByRole("textbox", { name: "Summary" });
  await summary.fill("short");
  await summary.blur();
  await expect(summary).toHaveAttribute("aria-invalid", "true");
  expect(submitted).toBe(0);
  await page.getByRole("button", { name: "Submit project" }).click();
  expect(submitted).toBe(0);
});

test("standard account form validates before submit and again after correction", async ({
  page,
  signIn,
}) => {
  await page.addInitScript(() => localStorage.setItem("hackos-language", "en"));
  await signIn.open();
  await signIn.email.fill("broken");
  await expect(signIn.email).not.toHaveAttribute("aria-invalid", "true");
  await signIn.email.blur();
  await expect(signIn.email).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("alert").filter({ hasText: "Enter a valid email" })).toBeVisible();
  await signIn.email.fill("valid@example.org");
  await signIn.email.blur();
  await expect(signIn.email).toHaveAttribute("aria-invalid", "false");
});
