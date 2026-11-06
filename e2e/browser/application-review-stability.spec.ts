import {
  installApplicationReviewFixture,
  openApplicationReview,
} from "./application-review-fixture";
import { expect, test } from "./fixtures";

// H13: arrow navigation must not echo reviews or repeatedly reload the response list.
for (const peer of [false, true]) {
  const width = 1920;
  test(`arrow navigation settles with ${peer ? "two review tabs" : "one review tab"}`, async ({
    page,
  }, info) => {
    test.skip(info.project.name === "mobile-chromium", "Review lifecycle regression");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const state = await installApplicationReviewFixture(page.context(), { navigation: true });
    const { composer } = await openApplicationReview(page, width);
    if (peer) {
      const other = await page.context().newPage();
      other.on("pageerror", (error) => errors.push(error.message));
      await other.goto("/applications/1?tab=review&response=10");
      await expect(other.getByRole("dialog", { name: "Avery Applicant" })).toBeVisible();
      await page.bringToFront();
    }
    for (let turn = 0; turn < 5; turn += 1) {
      await page.getByRole("button", { name: "Next candidate" }).filter({ visible: true }).click();
      await expect(page.getByRole("dialog", { name: "Blair Applicant" })).toBeVisible();
      await expect(
        page.getByRole("textbox", { name: "Notes", exact: true }).filter({ visible: true }),
      ).toHaveValue("Second review");
      await page
        .getByRole("button", { name: "Previous candidate" })
        .filter({ visible: true })
        .click();
      await expect(page.getByRole("dialog", { name: "Avery Applicant" })).toBeVisible();
    }
    await page.waitForTimeout(300);
    const settledReads = state.responseReads;
    await page.waitForTimeout(1500);
    expect(errors).toEqual([]);
    expect(state.responseReads).toBe(settledReads);
    expect(state.responseReads).toBe(peer ? 2 : 1);
    expect(state.saveCount).toBe(0);
    await expect(composer.getByRole("button", { name: "4", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(
      page.getByRole("textbox", { name: "Notes", exact: true }).filter({ visible: true }),
    ).toHaveValue("");
    await page.screenshot({ path: info.outputPath(`review-navigation-stable-${width}.png`) });
  });
}
