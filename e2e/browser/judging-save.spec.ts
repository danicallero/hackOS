import { expect, test } from "./fixtures";
import { setupJudging } from "./judging-helpers";

// H36: exercise score-only saves, text blur, lease conflicts and retry in the real UI.
test("saves judging edits and displays save failures once", async ({ page }) => {
  const judging = await setupJudging(page);
  const { patches } = judging;
  await page.goto("/judging");
  // Links share one row and the totals show during the hacking window.
  await expect(page.getByRole("link", { name: "GitHub", exact: true })).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Pitch deck", exact: true })).toHaveCount(1);
  // A YouTube video is embedded in the details, so it is never a link.
  await expect(page.getByRole("link", { name: "Demo video", exact: true })).toHaveCount(0);
  await expect(page.getByText("42", { exact: true })).toBeVisible();
  await page.screenshot({ path: "artifacts/judging-view.png", fullPage: true });
  // The card never shows project information; View project does.
  await expect(page.getByText("TypeScript, PostgreSQL", { exact: true })).toBeHidden();
  await expect(page.getByText("A project with real-time collaboration.")).toBeHidden();
  await page.getByRole("button", { name: "View project", exact: true }).click();
  await expect(page.getByText("TypeScript, PostgreSQL", { exact: true })).toBeVisible();
  await page.screenshot({ path: "artifacts/judging-project-details.png", fullPage: true });
  await page.getByRole("button", { name: "View project", exact: true }).click();
  await page.getByRole("button", { name: "6", exact: true }).click();
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0]).toEqual({ scores: { score: 6 }, submit: false });
  const notes = page.getByLabel("Notes", { exact: true });
  await notes.click();
  await notes.fill("Strong presentation");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => judging.review.notes).toBe("Strong presentation");
  judging.state.rejectSave = true;
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const saveError = page
    .getByRole("alert")
    .filter({ hasText: "Your editing lease has expired or belongs to another judge." });
  await expect(saveError).toBeVisible();
  await expect(
    page.getByText("Your editing lease has expired or belongs to another judge.", { exact: true }),
  ).toHaveCount(1);
  await saveError.scrollIntoViewIfNeeded();
  await expect(page.getByText("Draft saved.", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "artifacts/judging-save-error.png", fullPage: true });
  judging.state.rejectSave = false;
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(saveError).toHaveCount(0);
  await expect.poll(() => judging.review.scores.score).toBe(7);
  await page.screenshot({ path: "artifacts/judging-save-recovered.png", fullPage: true });
  await page.getByRole("button", { name: "Submit review", exact: true }).click();
  await expect.poll(() => judging.review.status).toBe("submitted");
});
