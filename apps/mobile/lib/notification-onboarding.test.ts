jest.mock("./api", () => ({ apiFetch: jest.fn() }));

import { apiFetch } from "./api";
import {
  completeNotificationOnboarding,
  markNotificationOnboardingHandled,
  onboardingEmailDraft,
  resetNotificationOnboardingHandled,
  shouldPresentNotificationOnboarding,
} from "./notification-onboarding";
import { notifySignOut } from "./sign-out-events";
import type { Me } from "./types";

// H51: first-run notification channel prompt.

const me = {
  id: 1,
  hasEventAccess: true,
  accountState: "active",
  notificationOnboardingRequired: true,
} as Me;

const ready = {
  me,
  offline: false,
  navigationReady: true,
  sessionPending: false,
  pathname: "/schedule",
  profileTasksPending: false,
};

const prefs = (hasPushDevice: boolean) => ({
  channels: ["in_app", "email", "push"] as ("in_app" | "email" | "push")[],
  mandatoryCategories: ["queue"],
  emailOptInCategories: ["queue", "schedule", "challenge"],
  hasPushDevice,
  overrides: [],
});

beforeEach(() => {
  resetNotificationOnboardingHandled();
  jest.mocked(apiFetch).mockReset();
});

describe("shouldPresentNotificationOnboarding", () => {
  it("presents once per session until sign-out", () => {
    expect(shouldPresentNotificationOnboarding(ready)).toBe(true);
    markNotificationOnboardingHandled(1);
    expect(shouldPresentNotificationOnboarding(ready)).toBe(false);
    notifySignOut();
    expect(shouldPresentNotificationOnboarding(ready)).toBe(true);
  });

  it("waits for the profile sheet, scanners and an answered prompt", () => {
    expect(shouldPresentNotificationOnboarding({ ...ready, profileTasksPending: true })).toBe(
      false,
    );
    expect(shouldPresentNotificationOnboarding({ ...ready, pathname: "/scan" })).toBe(false);
    expect(
      shouldPresentNotificationOnboarding({
        ...ready,
        me: { ...me, notificationOnboardingRequired: false } as Me,
      }),
    ).toBe(false);
  });
});

describe("channel draft", () => {
  it("is email off with a device and email on without one", () => {
    expect(onboardingEmailDraft(prefs(true))).toEqual({
      queue: false,
      schedule: false,
      challenge: false,
    });
    expect(onboardingEmailDraft(prefs(false))).toEqual({
      queue: true,
      schedule: true,
      challenge: true,
    });
  });

  it("stores only changed choices, never the locked queue email", async () => {
    jest.mocked(apiFetch).mockResolvedValue(prefs(true));
    await completeNotificationOnboarding(prefs(true), {
      queue: true,
      schedule: false,
      challenge: false,
    });
    expect(JSON.parse(jest.mocked(apiFetch).mock.calls[0]?.[1]?.body as string)).toEqual({
      preferences: [{ category: "queue", channel: "email", enabled: true }],
    });

    jest.mocked(apiFetch).mockClear();
    await completeNotificationOnboarding(prefs(false), {
      queue: false,
      schedule: false,
      challenge: true,
    });
    expect(JSON.parse(jest.mocked(apiFetch).mock.calls[0]?.[1]?.body as string)).toEqual({
      preferences: [{ category: "schedule", channel: "email", enabled: false }],
    });
  });
});
