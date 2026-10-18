import { expect, shellUser, test } from "./fixtures";

// H36: exercise score-only saves, text blur, lease conflicts and retry in the real UI.
for (const layout of ["on", "off"]) {
  test(`judging cards share one left edge, expanded ${layout} (R017)`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    const panel = [
      {
        key: "score",
        kind: "scale",
        label: { en: "Score", es: "Score", gl: "Score" },
        min: 0,
        max: 10,
        required: true,
      },
    ];
    const challenge = { id: 41, title: "Challenge", judging_panel_criteria: panel };
    const room = { id: 7, name: "Room Alpha", slug: "alpha", status: "active" };
    const entry = {
      id: 501,
      repo_id: 91,
      repo_name: "Deterministic Team",
      challenge_id: 41,
      status: "presenting",
      assigned_room_id: 7,
      room_entered_at: new Date(Date.now() - 9 * 60000).toISOString(),
      presentation_started_at: new Date(Date.now() - 200000).toISOString(),
      presentation_total_seconds: 480,
    };
    let review = {
      scores: {} as Record<string, unknown>,
      notes: null as string | null,
      status: "draft",
    };
    let notesLeased = false;
    const rejectSave = false;
    const patches: Array<Record<string, unknown>> = [];
    await page.route("**/api/**", async (route) => {
      if (new URL(route.request().url()).pathname === "/api/me/public-profile") {
        return route.fallback();
      }
      const request = route.request();
      const path = new URL(request.url()).pathname;
      let body: unknown = [];
      if (path === "/api/me")
        body = { ...shellUser, capabilities: ["judge:panel", "projects:read"] };
      if (path === "/api/repos/91")
        body = {
          id: 91,
          name: "Deterministic Team",
          description: "A project with real-time collaboration.",
          githubUrl: "https://github.com/team/repo",
          template: [
            {
              key: "video",
              kind: "text",
              label: { en: "Demo video", es: "Vídeo", gl: "Vídeo" },
              project_video: true,
              required: false,
            },
            {
              key: "stack",
              kind: "library",
              label: { en: "Technologies", es: "Tecnologías", gl: "Tecnoloxías" },
              required: false,
            },
          ],
          sections: [],
          responses: { stack: ["TypeScript", "PostgreSQL"], video: "https://youtu.be/abcdefghijk" },
          members: [],
          challenges: [],
          files: [],
        };
      if (path === "/api/projects/91/github-activity")
        body = {
          people: [],
          totals: {
            commits: 42,
            pullRequests: 7,
            merged: 5,
          },
        };
      if (path === "/api/queue/repos/91/challenges")
        body = [
          {
            entry_id: 501,
            repo_id: 91,
            id: 41,
            title: "FOSS",
            queue_group_id: 5,
            queue_name: "Open",
            status: "presenting",
            position: null,
            called_at: null,
            eta_minutes: null,
            room_id: 7,
            room_name: "Room Alpha",
            judging_rooms: [],
          },
          {
            entry_id: 502,
            repo_id: 91,
            id: 42,
            title: "Rookie",
            queue_group_id: 5,
            queue_name: "Open",
            status: "presenting",
            position: null,
            called_at: null,
            eta_minutes: null,
            room_id: 7,
            room_name: "Room Alpha",
            judging_rooms: [],
          },
          {
            entry_id: 503,
            repo_id: 91,
            id: 43,
            title: "Best use of AI",
            queue_group_id: 5,
            queue_name: "Open",
            status: "presenting",
            position: null,
            called_at: null,
            eta_minutes: null,
            room_id: 7,
            room_name: "Room Alpha",
            judging_rooms: [],
          },
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
      if (path === "/api/challenges") body = { challenges: [challenge] };
      if (path === "/api/queue/rooms") body = [room];
      if (path.endsWith("/view"))
        body = {
          room,
          challenge,
          state: { room_id: 7, is_paused: false },
          active: entry,
          called: [],
          next: [],
          crossRoomSkips: [],
        };
      if (path.endsWith("/pace"))
        body = {
          roomId: 7,
          desiredMinutesPerTeam: 8,
          challengeMaxMinutes: null,
          roomCount: 1,
          pendingCount: 1,
          remainingMinutes: null,
          requiredMinutes: 8,
          insufficientTime: false,
          suggestedMinutesPerTeam: null,
          autoAdjusted: false,
          effectiveMinutesPerTeam: 8,
          calledTooLongThresholdMinutes: 15,
        };
      if (path.endsWith("/progress"))
        body = {
          challengeId: 41,
          waiting: 0,
          called: 0,
          inProgress: 1,
          evaluated: 0,
          disqualified: 0,
          other: 0,
          byStatus: { in_room: 1 },
          avgEvaluationMinutes: null,
        };
      if (path.endsWith("/leases")) {
        if (request.method() === "PUT") notesLeased = true;
        if (request.method() === "DELETE") notesLeased = false;
        body =
          request.method() === "GET"
            ? []
            : {
                field: "notes",
                judge_id: 1,
                expires_at: new Date(Date.now() + 30000).toISOString(),
              };
      }
      if (path.endsWith("/review")) {
        if (request.method() === "PATCH") {
          const patch = request.postDataJSON();
          patches.push(patch);
          if (rejectSave || ("notes" in patch && !notesLeased)) {
            return route.fulfill({
              status: 409,
              contentType: "application/json",
              body: JSON.stringify({
                error: {
                  code: "conflict",
                  message: "reworded server text",
                  details: { code: "review_field_lease_required" },
                },
              }),
            });
          }
          review = {
            scores: { ...review.scores, ...patch.scores },
            notes: patch.notes ?? review.notes,
            status: patch.submit ? "submitted" : "draft",
          };
        }
        body = review;
      }
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    });
    await page.addInitScript(() => localStorage.setItem("hackos.cookie-notice.dismissed", "true"));
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
        details: rect(
          [...card.querySelectorAll("button")].find((b) => b.textContent === "Project details"),
        )?.left,
        reviewFooterRight: rect(review.querySelector("footer button:last-child"))?.right,
        reviewHeaderRight: rect(review.querySelector("header [role='status'] ~ *"))?.right,
      };
    });
    // Challenges that share the room's queue are all being judged now (H29).
    await expect(page.getByText("Now", { exact: true })).toHaveCount(3);
    await expect(page.getByText("FOSS")).toBeVisible();
    await expect(page.getByText("Best use of AI")).toBeVisible();
    const lefts = [
      edges.title,
      edges.prep,
      edges.fact,
      ...(layout === "off" ? [edges.details] : []),
    ] as number[];
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(1);
    expect(
      Math.abs((edges.reviewFooterRight ?? 0) - (edges.reviewHeaderRight ?? 0)),
    ).toBeLessThanOrEqual(1);
  });
}
