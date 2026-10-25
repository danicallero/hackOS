import type { Page } from "@playwright/test";
import { shellUser } from "./fixtures";

export async function setupJudging(
  page: Page,
  options: { entry?: Record<string, unknown>; pitchDeck?: boolean } = {},
) {
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
    ...options.entry,
  };
  let review = {
    scores: {} as Record<string, unknown>,
    notes: null as string | null,
    status: "draft",
  };
  let notesLeased = false;
  const state = { rejectSave: false };
  const patches: Array<Record<string, unknown>> = [];
  await page.route("**/api/**", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/me/public-profile") {
      return route.fallback();
    }
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let body: unknown = [];
    if (path === "/api/me") body = { ...shellUser, capabilities: ["judge:panel", "projects:read"] };
    if (path === "/api/repos/91")
      body = {
        id: 91,
        name: "Deterministic Team",
        description: "A project with real-time collaboration.",
        githubUrl: "https://github.com/team/repo",
        template: [
          ...(options.pitchDeck === false
            ? []
            : [
                {
                  key: "deck",
                  kind: "text",
                  label: { en: "Pitch deck", es: "Presentación", gl: "Presentación" },
                  validation: { text_condition: "url" },
                  required: false,
                },
              ]),
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
        responses: {
          stack: ["TypeScript", "PostgreSQL"],
          video: "https://youtu.be/abcdefghijk",
          ...(options.pitchDeck === false ? {} : { deck: "https://slides.example.test/deck" }),
        },
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
          : { field: "notes", judge_id: 1, expires_at: new Date(Date.now() + 30000).toISOString() };
    }
    if (path.endsWith("/review")) {
      if (request.method() === "PATCH") {
        const patch = request.postDataJSON();
        patches.push(patch);
        if (state.rejectSave || ("notes" in patch && !notesLeased)) {
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
  return {
    patches,
    state,
    get review() {
      return review;
    },
  };
}
