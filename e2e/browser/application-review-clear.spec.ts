import {
  installApplicationReviewFixture,
  openApplicationReview,
} from "./application-review-fixture";
import { expect, test } from "./fixtures";

// H12: clearing a score must not dismiss the modal when its composer is detached.
for (const width of [1920, 393]) {
  test(`clearing a review score retains the editor at ${width}px`, async ({ page }, info) => {
    test.skip(
      !["chromium", "webkit"].includes(info.project.name),
      "Pointer/focus regression in Chromium and Safari",
    );
    const state = await installApplicationReviewFixture(page.context());
    const { dialog, clear } = await openApplicationReview(page, width);
    const readsBeforeClear = state.responseReads;
    await clear.click();
    await expect(dialog).toBeVisible();
    await expect(clear).toBeDisabled();
    await expect.poll(() => state.saveCount).toBe(1);
    expect(state.storedScore).toBeNull();
    await expect.poll(() => state.responseReads).toBeGreaterThan(readsBeforeClear);
    await expect(dialog).toBeVisible();
    await expect(
      page.getByRole("button", { name: "4", exact: true }).filter({ visible: true }),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(
      page.getByRole("textbox", { name: "Notes", exact: true }).filter({ visible: true }),
    ).toBeEditable();
    await page.screenshot({ path: info.outputPath(`review-score-cleared-${width}.png`) });
  });
}
