jest.mock("./api", () => ({ apiFetch: jest.fn() }));

import {
  isScannerPath,
  markProfileTasksHandled,
  mealPlanAnswers,
  parseProfileTasks,
  resetProfileTasksHandled,
  setNoRestrictions,
  shouldPresentProfileTasks,
  toggleIntolerance,
} from "./profile-tasks";
import { notifySignOut } from "./sign-out-events";
import type { Me } from "./types";

// #933: next-entry prompt trigger and dietary/meal helpers.

const me = {
  id: 1,
  hasEventAccess: true,
  accountState: "active",
  pendingProfileTasks: ["dietary"],
} as Me;

const ready = {
  me,
  offline: false,
  navigationReady: true,
  sessionPending: false,
  pathname: "/schedule",
};

beforeEach(() => resetProfileTasksHandled());

describe("shouldPresentProfileTasks", () => {
  it("presents pending tasks once per session until sign-out", () => {
    expect(shouldPresentProfileTasks(ready)).toBe(true);
    markProfileTasksHandled(1);
    expect(shouldPresentProfileTasks(ready)).toBe(false);
    notifySignOut();
    expect(shouldPresentProfileTasks(ready)).toBe(true);
  });

  it("never opens over a scanner", () => {
    expect(shouldPresentProfileTasks({ ...ready, pathname: "/scan" })).toBe(false);
    expect(shouldPresentProfileTasks({ ...ready, pathname: "/scan/person/4" })).toBe(false);
    expect(shouldPresentProfileTasks({ ...ready, pathname: "/activities/12" })).toBe(false);
    // Person operations mount QrCamera/NfcReader under every tab.
    for (const path of [
      "/activities/person/4",
      "/activities/person/presence/4",
      "/others/person/4",
      "/others/person/presence/4",
      "/scan/person/presence/4",
    ]) {
      expect(isScannerPath(path)).toBe(true);
    }
    expect(isScannerPath("/activities/people")).toBe(false);
    expect(isScannerPath("/others/statistics")).toBe(false);
  });

  it("waits for the initial session and the root redirect", () => {
    expect(shouldPresentProfileTasks({ ...ready, sessionPending: true })).toBe(false);
    expect(shouldPresentProfileTasks({ ...ready, pathname: "/" })).toBe(false);
    expect(shouldPresentProfileTasks({ ...ready, pathname: "/profile-tasks" })).toBe(false);
  });

  it("waits for a fresh profile and skips cached profiles from older builds", () => {
    expect(shouldPresentProfileTasks({ ...ready, offline: true })).toBe(false);
    expect(shouldPresentProfileTasks({ ...ready, navigationReady: false })).toBe(false);
    expect(shouldPresentProfileTasks({ ...ready, me: null })).toBe(false);
    const legacy = { ...me, pendingProfileTasks: undefined } as Me;
    expect(shouldPresentProfileTasks({ ...ready, me: legacy })).toBe(false);
    expect(shouldPresentProfileTasks({ ...ready, me: { ...me, pendingProfileTasks: [] } })).toBe(
      false,
    );
  });
});

describe("helpers", () => {
  it("keeps No restrictions exclusive", () => {
    const draft = { noRestrictions: false, intolerances: [2], notes: "nuts" };
    const none = setNoRestrictions(draft, true);
    expect(none).toEqual({ noRestrictions: true, intolerances: [], notes: "" });
    expect(toggleIntolerance(none, 5, true)).toEqual({
      noRestrictions: false,
      intolerances: [5],
      notes: "",
    });
  });

  it("answers every unlocked meal and skips locked ones", () => {
    const meal = {
      activityId: 1,
      name: "Lunch",
      nameI18n: null,
      startsAt: "2026-10-17T11:30:00.000Z",
      endsAt: "2026-10-17T13:00:00.000Z",
      location: null,
      attending: null,
      locked: false,
    };
    const plan = {
      confirmedAt: null,
      meals: [
        meal,
        { ...meal, activityId: 2, attending: true },
        { ...meal, activityId: 3, locked: true },
      ],
    };
    expect(mealPlanAnswers(plan, { 2: false })).toEqual([
      { activityId: 1, attending: false },
      { activityId: 2, attending: false },
    ]);
  });

  it("parses only known tasks", () => {
    expect(parseProfileTasks("meal_plan,bogus")).toEqual(["meal_plan"]);
    expect(parseProfileTasks(undefined)).toEqual([]);
  });
});
