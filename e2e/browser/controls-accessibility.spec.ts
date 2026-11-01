import { expect, test } from "./fixtures";

// H1-H5: route titles must be discoverable through heading navigation.
for (const route of ["/login", "/signup", "/forgot-password", "/reset-password?token=example"]) {
  test(`auth form heading: ${route}`, async ({ signIn, page }) => {
    await signIn.open();
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
}

test("sign-in focuses the invalid password and exposes its inline error", async ({
  signIn,
  page,
}) => {
  await signIn.open();
  await signIn.email.fill("person@example.com");
  await signIn.submit.click();
  await expect(signIn.password).toBeFocused();
  await expect(signIn.password).toHaveAttribute("aria-invalid", "true");
  const message = page.locator('[data-slot="form-message"]');
  await expect(message).toBeVisible();
  const messageId = await message.getAttribute("id");
  expect((await signIn.password.getAttribute("aria-describedby"))?.split(" ")).toContain(messageId);
  // The reveal button remains keyboard operable and preserves the input value.
  await signIn.password.fill("example password");
  const reveal = page.getByRole("button", {
    name: /mostrar contraseña|show password|mostrar contrasinal/i,
  });
  await reveal.focus();
  await page.keyboard.press("Space");
  await expect(signIn.password).toHaveAttribute("type", "text");
  await expect(page.getByRole("button", { pressed: true })).toBeVisible();
  await expect(signIn.password).toHaveValue("example password");
});

test("controlled side panel traps focus and returns to its external opener", async ({
  signIn,
  page,
}, info) => {
  await page.addInitScript(() => {
    localStorage.setItem("hackos-language", "en");
    localStorage.setItem("hackos.cookie-notice.dismissed", "true");
  });
  await signIn.open();
  await page.goto("/design-system");
  const opener = page.getByRole("button", { name: "Open record editor", exact: true }).first();
  // Safari's default macOS preference omits buttons from Tab traversal; explicit
  // focus models Full Keyboard Access while retaining native button semantics.
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Open record editor" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(":focus")).toHaveCount(1);
  const close = dialog.getByRole("button", { name: "Close", exact: true });
  await close.focus();
  await page.keyboard.press("Tab");
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await page.screenshot({ path: `/tmp/tetra-controls-panel-${info.project.name}.png` });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("language menu includes its visible language code and supports keyboard selection", async ({
  signIn,
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("hackos-language", "en"));
  await signIn.open();
  const language = page.getByRole("button", { name: "Language: EN", exact: true });
  await language.focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("End");
  await expect(page.getByRole("menuitemradio", { name: "English", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(language).toBeFocused();
});

test("password recovery announces the completed form by focusing its confirmation", async ({
  signIn,
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("hackos-language", "en"));
  await signIn.open();
  await page.route("**/api/auth/request-password-reset", (route) =>
    route.fulfill({ json: { status: true } }),
  );
  await page.goto("/forgot-password");
  await page.getByRole("textbox", { name: "Email", exact: true }).fill("person@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeFocused();
});

test("native dialog trigger and a nested select retain their focus destinations", async ({
  signIn,
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("hackos-language", "en");
    localStorage.setItem("hackos.cookie-notice.dismissed", "true");
  });
  await signIn.open();
  await page.goto("/design-system");
  const primary = page.getByRole("button", { name: "Primary", exact: true }).first();
  await primary.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Dialog", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(primary).toBeFocused();
  const opener = page.getByRole("button", { name: "Open record editor", exact: true }).first();
  await opener.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("dialog", { name: "Open record editor" });
  const width = panel.getByRole("combobox", { name: "Editor width" });
  await width.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(width).toBeFocused();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
});

test("reduced motion suppresses overlay animation without breaking focus", async ({
  signIn,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("hackos-language", "en");
    localStorage.setItem("hackos.cookie-notice.dismissed", "true");
  });
  await signIn.open();
  await page.goto("/design-system");
  const opener = page.getByRole("button", { name: "Open record editor", exact: true }).first();
  // Keyboard activation: WebKit does not focus buttons on mouse click.
  await opener.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("dialog", { name: "Open record editor" });
  await expect(panel).toHaveCSS("animation-name", "none");
  await expect(panel).toHaveCSS("transition-property", "none");
  await expect(panel.locator(":focus")).toHaveCount(1);
  await panel.getByRole("combobox", { name: "Editor width" }).click();
  await expect(page.getByRole("listbox")).toHaveCSS("animation-name", "none");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
});

test("forced colors retain a visible native input outline", async ({ signIn, page }) => {
  await page.emulateMedia({ forcedColors: "active" });
  await signIn.open();
  await signIn.email.focus();
  await expect(signIn.email).toHaveCSS("outline-style", "solid");
  await expect(signIn.email).toHaveCSS("outline-width", "2px");
});

test("toast actions persist and expose independent native controls", async ({ signIn, page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("hackos-language", "en");
    localStorage.setItem("hackos.cookie-notice.dismissed", "true");
  });
  await signIn.open();
  await page.goto("/design-system");
  await page.getByRole("button", { name: "Show feedback with an action" }).click();
  const toast = page.locator("[data-sileo-toast]");
  await expect(toast).toHaveJSProperty("tagName", "DIV");
  const undo = toast.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeVisible();
  // Cross the old 6–8 second expiry and verify keyboard access remains.
  await page.waitForTimeout(8_100);
  await expect(undo).toBeVisible();
  await undo.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-preview-notice]")).toBeVisible();
  // Undo opens its own confirmation toast; each one must close from the keyboard.
  const closes = toast.getByRole("button", { name: "Close", exact: true });
  for (let remaining = await closes.count(); remaining > 0; remaining--) {
    await expect(closes.first()).toHaveJSProperty("tagName", "BUTTON");
    await closes.first().focus();
    await page.keyboard.press("Space");
    await expect(closes).toHaveCount(remaining - 1);
  }
});
