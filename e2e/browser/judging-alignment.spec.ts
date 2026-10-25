import { expect, test } from "./fixtures";
import { setupJudging } from "./judging-helpers";

// H36: exercise score-only saves, text blur, lease conflicts and retry in the real UI.
for (const layout of ["on", "off"]) {
  test(`judging cards share one left edge, expanded ${layout} (R017)`, async ({ page }) => {
    await setupJudging(page, {
      entry: {
        status: "presenting",
        room_entered_at: new Date(Date.now() - 9 * 60000).toISOString(),
        presentation_started_at: new Date(Date.now() - 200000).toISOString(),
        presentation_total_seconds: 480,
      },
      pitchDeck: false,
    });
    await page.route("**/api/queue/repos/91/challenges", async (route) => {
      const body = [
        ...[
          { entry_id: 501, id: 41, title: "FOSS" },
          { entry_id: 502, id: 42, title: "Rookie" },
          { entry_id: 503, id: 43, title: "Best use of AI" },
        ].map((challenge) => ({
          ...challenge,
          repo_id: 91,
          queue_group_id: 5,
          queue_name: "Open",
          status: "presenting",
          position: null,
          called_at: null,
          eta_minutes: null,
          room_id: 7,
          room_name: "Room Alpha",
          judging_rooms: [],
        })),
        {
          entry_id: 504,
          repo_id: 91,
          id: 44,
          title: "Sustainability",
          queue_group_id: null,
          queue_name: null,
          status: "waiting",
          position: 3,
          called_at: null,
          eta_minutes: 24,
          room_id: null,
          room_name: null,
          judging_rooms: [],
        },
      ];
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.addInitScript(
      (value) => localStorage.setItem("hackos.judging.focus-layout", value),
      layout,
    );
    await page.goto("/judging");
    await expect(page.getByRole("link", { name: "GitHub", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "6", exact: true }).click();
    const edges = await page.evaluate(() => {
      const rect = (el: Element | null | undefined) => el?.getBoundingClientRect();
      const card = [...document.querySelectorAll("h2")]
        .find((h) => h.textContent === "Deterministic Team" && !h.closest("aside"))
        ?.closest(".rounded-surface") as HTMLElement;
      const review = document.querySelector("aside[aria-label='Scoring']") as HTMLElement;
      const text = (root: Element, value: string) =>
        [...root.querySelectorAll("*")].find(
          (el) => el.children.length === 0 && el.textContent === value,
        );
      return {
        title: rect(card.querySelector("h2"))?.left,
        prep: rect(text(card, "Preparation time"))?.left,
        fact: rect(text(card, "Members"))?.left,
        link: rect(card.querySelector("a[href='https://github.com/team/repo']"))?.left,
        reviewFooterRight: rect(review.querySelector("footer button:last-child"))?.right,
        reviewHeaderRight: rect(review.querySelector("header [role='status'] ~ *"))?.right,
      };
    });
    // Challenges that share the room's queue are all being judged now (H29).
    await expect(page.getByText("Now", { exact: true })).toHaveCount(3);
    // The challenges are named, never the shared queue that groups them.
    await expect(page.getByText("Open", { exact: true })).toHaveCount(0);
    await expect(page.getByText("FOSS")).toBeVisible();
    await expect(page.getByText("Best use of AI")).toBeVisible();
    const lefts = [edges.title, edges.prep, edges.fact] as number[];
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(1);
    expect(
      Math.abs((edges.reviewFooterRight ?? 0) - (edges.reviewHeaderRight ?? 0)),
    ).toBeLessThanOrEqual(1);
  });
}
