import { expect, shellUser, test } from "./fixtures";

// H36: exercise score-only saves, text blur, lease conflicts and retry in the real UI.
test("saves judging edits and displays save failures once", async ({ page }) => {
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
    status: "in_room",
    assigned_room_id: 7,
  };
  let review = {
    scores: {} as Record<string, unknown>,
    notes: null as string | null,
    status: "draft",
  };
  let notesLeased = false;
  let rejectSave = false;
  const patches: Array<Record<string, unknown>> = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown = [];
    if (path === "/api/me") body = { ...shellUser, capabilities: ["judge:panel"] };
    if (path === "/api/challenges") body = { challenges: [challenge] };
    if (path === "/api/queue/rooms") body = [room];
    if (path.endsWith("/view"))
      body = {
        room,
        challenge,
        state: { room_id: 7, is_paused: false, desired_minutes_per_team: 8 },
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
          : { field: "notes", judge_id: 1, expires_at: new Date(Date.now() + 30000).toISOString() };
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
                message: "Your editing lease has expired or belongs to another judge",
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
  await page.goto("/judging");
  await page.getByRole("button", { name: "6", exact: true }).click();
  await expect.poll(() => patches.length).toBe(1);
  expect(patches[0]).toEqual({ scores: { score: 6 }, submit: false });
  const notes = page.getByLabel("Notes", { exact: true });
  await notes.click();
  await notes.fill("Strong presentation");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect.poll(() => review.notes).toBe("Strong presentation");
  rejectSave = true;
  await page.getByRole("button", { name: "7", exact: true }).click();
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const saveError = page
    .getByRole("alert")
    .filter({ hasText: "Your editing lease has expired or belongs to another judge" });
  await expect(saveError).toBeVisible();
  await expect(
    page.getByText("Your editing lease has expired or belongs to another judge", { exact: true }),
  ).toHaveCount(1);
  await saveError.scrollIntoViewIfNeeded();
  await expect(page.getByText("Draft saved.", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: "artifacts/judging-save-error.png", fullPage: true });
  rejectSave = false;
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(saveError).toHaveCount(0);
  await expect.poll(() => review.scores.score).toBe(7);
  await page.screenshot({ path: "artifacts/judging-save-recovered.png", fullPage: true });
  await page.getByRole("button", { name: "Submit review", exact: true }).click();
  await expect.poll(() => review.status).toBe("submitted");
});
