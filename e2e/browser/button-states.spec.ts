import { expect, test } from "./fixtures";

const variants = ["default", "secondary", "outline", "ghost", "destructive", "link"] as const;

for (const theme of ["light", "dark"]) {
  for (const language of ["es", "gl", "en"]) {
    test(`button specimens stay legible and fit in ${theme}/${language}`, async ({ page }) => {
      await page.addInitScript(
        ({ theme, language }) => {
          localStorage.setItem("theme", theme);
          localStorage.setItem("hackos-language", language);
          localStorage.setItem("hackos.cookie-notice.dismissed", "true");
        },
        { theme, language },
      );
      await page.route("**/api/me", (route) => route.fulfill({ status: 401, body: "{}" }));
      await page.goto("/design-system");
      await expect(page.locator("html")).toHaveAttribute("data-locale-ready", "true");
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      for (const variant of variants) {
        const row = page.locator(`[data-button-specimen="${variant}"]`);
        const loading = row.locator('[data-button-state="loading"] button');
        const disabled = row.locator('[data-button-state="disabled"] button');
        await expect(loading).toBeDisabled();
        await expect(loading).toHaveAttribute("aria-busy", "true");
        await expect(loading.locator('[data-slot="button-spinner"]')).toBeVisible();
        await expect(disabled).toBeDisabled();
        expect(await loading.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
        for (const state of ["default", "hover", "focus", "pressed", "loading"]) {
          const button = row.locator(`[data-button-state="${state}"] button`);
          const result = await button.evaluate((element) => {
            const style = getComputedStyle(element);
            let parent = element.parentElement;
            while (parent && getComputedStyle(parent).backgroundColor === "rgba(0, 0, 0, 0)")
              parent = parent.parentElement;
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 1;
            const ctx = canvas.getContext("2d")!;
            function color(value: string) {
              ctx.clearRect(0, 0, 1, 1);
              ctx.fillStyle = value;
              ctx.fillRect(0, 0, 1, 1);
              return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map((v) => v / 255);
            }
            function luminance(rgb: number[]) {
              return rgb.reduce(
                (sum, c, i) =>
                  sum +
                  [0.2126, 0.7152, 0.0722][i] *
                    (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4),
                0,
              );
            }
            const bg =
              style.backgroundColor === "rgba(0, 0, 0, 0)"
                ? getComputedStyle(parent!).backgroundColor
                : style.backgroundColor;
            const pair = [luminance(color(style.color)), luminance(color(bg))].sort(
              (a, b) => b - a,
            );
            const rect = element.getBoundingClientRect();
            const slot = element.parentElement!.getBoundingClientRect();
            return {
              contrast: (pair[0] + 0.05) / (pair[1] + 0.05),
              fits: rect.right <= slot.right + 1,
            };
          });
          expect(result.contrast, `${variant}/${state}`).toBeGreaterThanOrEqual(4.5);
          expect(result.fits, `${variant}/${state} should fit its column`).toBe(true);
        }
      }
      // A valid text contrast alone does not prove the primary hover is perceptible.
      const difference = await page.locator('[data-button-specimen="default"]').evaluate((row) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d")!;
        const sample = (state: string) => {
          ctx.fillStyle = getComputedStyle(
            row.querySelector(`[data-button-state="${state}"] button`)!,
          ).backgroundColor;
          ctx.fillRect(0, 0, 1, 1);
          return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        const normal = sample("default");
        const hover = sample("hover");
        return Math.hypot(...normal.map((channel, index) => channel - hover[index]));
      });
      expect(difference, "primary hover must visibly differ from its default fill").toBeGreaterThan(
        60,
      );
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });
  }
}

test.describe("real button interaction", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("hackos.cookie-notice.dismissed", "true"));
    await page.route("**/api/me", (route) => route.fulfill({ status: 401, body: "{}" }));
    await page.goto("/design-system");
    await expect(page.locator("html")).toHaveAttribute("data-locale-ready", "true");
  });

  test("only cursor devices get hover; press and keyboard focus give distinct feedback", async ({
    page,
    isMobile,
  }) => {
    const button = page.locator(
      '[data-button-specimen="default"] [data-button-state="default"] button',
    );
    const background = () => button.evaluate((el) => getComputedStyle(el).backgroundColor);
    const initial = await background();
    await button.hover();
    if (isMobile) expect(await background()).toBe(initial);
    else await expect.poll(background).not.toBe(initial);
    const hover = await background();
    await page.mouse.down();
    await expect.poll(background).not.toBe(hover);
    await expect
      .poll(() => button.evaluate((el) => getComputedStyle(el).transform))
      .not.toBe("none");
    await page.mouse.move(0, 0);
    await page.mouse.up();
    await page.keyboard.press("Tab");
    await button.focus();
    expect(await button.evaluate((el) => el.matches(":focus-visible"))).toBe(true);
    expect(await button.evaluate((el) => getComputedStyle(el).outlineWidth)).toBe("2px");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(button).toBeFocused();
  });

  test("loading stays inside the action, replaces its icon and clears after completion", async ({
    page,
  }) => {
    const button = page
      .locator('[data-variant="default"]')
      .filter({ has: page.locator("svg") })
      .last();
    const name = await button.innerText();
    await button.click();
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect(button.locator('[data-slot="button-spinner"]')).toBeVisible();
    await expect(button.locator('svg:not([data-slot="button-spinner"])')).toBeHidden();
    expect(await button.innerText()).toBe(name);
    await expect(button).toBeEnabled();
    await expect(button.locator('[data-slot="button-spinner"]')).toHaveCount(0);
  });

  test("disabled actions do not acquire hover or press feedback", async ({ page }) => {
    for (const variant of variants) {
      const button = page.locator(
        `[data-button-specimen="${variant}"] [data-button-state="disabled"] button`,
      );
      const paint = () =>
        button.evaluate((el) => {
          const style = getComputedStyle(el);
          return [style.backgroundColor, style.transform, style.textDecorationColor];
        });
      const initial = await paint();
      await button.hover();
      await page.mouse.down();
      expect(await paint()).toEqual(initial);
      expect(await button.evaluate((el) => getComputedStyle(el).cursor)).toBe("not-allowed");
      await page.mouse.up();
    }
  });

  test("forced colors preserve the keyboard focus perimeter", async ({ page, browserName }) => {
    test.skip(browserName !== "chromium", "System-color emulation is checked in Chromium");
    await page.emulateMedia({ forcedColors: "active" });
    const button = page.locator(
      '[data-button-specimen="outline"] [data-button-state="default"] button',
    );
    await page.keyboard.press("Tab");
    await button.focus();
    const style = await button.evaluate((el) => {
      const css = getComputedStyle(el);
      return { width: css.outlineWidth, style: css.outlineStyle, color: css.outlineColor };
    });
    expect(style.width).toBe("2px");
    expect(style.style).toBe("solid");
    expect(style.color).not.toBe("rgba(0, 0, 0, 0)");
  });

  test("reduced motion keeps static press feedback and a visible, stationary loading glyph", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const button = page.locator(
      '[data-button-specimen="default"] [data-button-state="default"] button',
    );
    await button.hover();
    await page.mouse.down();
    expect(await button.evaluate((el) => getComputedStyle(el).transform)).toBe("none");
    expect(await button.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0s");
    await page.mouse.move(0, 0);
    await page.mouse.up();
    const spinner = page.locator('[data-button-specimen="icon"] [data-slot="button-spinner"]');
    await expect(spinner).toBeVisible();
    expect(await spinner.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  });
});
