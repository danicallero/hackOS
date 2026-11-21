import type { ResolvedOnboardingStep } from "@hackos/shared/onboarding";
import { describe, expect, it, vi } from "vitest";
import {
  currentStep,
  deferUntilTomorrow,
  hasPendingOnboarding,
  type OnboardingState,
  onboardingAfterConfirm,
  pendingSteps,
  stepAfter,
} from "./onboarding";

const apiGet = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ api: { get: apiGet } }));

const step = (
  name: ResolvedOnboardingStep["step"],
  status: ResolvedOnboardingStep["status"],
): ResolvedOnboardingStep => ({
  step: name,
  status,
  required: false,
  deferredUntil: null,
  actions: status === "pending" ? ["complete", "defer", "skip"] : [],
});

const state: OnboardingState = {
  eventKey: "hackudc-2027",
  revision: 1,
  steps: [
    step("welcome", "completed"),
    step("profile", "completed"),
    step("networking", "pending"),
    step("share", "skipped"),
    step("completion", "pending"),
  ],
};

describe("onboarding resume helpers", () => {
  it("resumes at the first pending step when none is requested", () => {
    expect(currentStep(state, null)?.step).toBe("networking");
  });

  it("honors a requested step that exists and ignores one that does not", () => {
    expect(currentStep(state, "share")?.step).toBe("share");
    expect(currentStep(state, "rsvp")?.step).toBe("networking");
  });

  it("lands on the last step when nothing is pending", () => {
    const done = {
      ...state,
      steps: state.steps.map((s) => ({ ...s, status: "completed" as const })),
    };
    expect(currentStep(done, null)?.step).toBe("completion");
    expect(hasPendingOnboarding(done)).toBe(false);
  });

  it("derives pending steps and the following step from server order only", () => {
    expect(pendingSteps(state).map((s) => s.step)).toEqual(["networking", "completion"]);
    expect(stepAfter(state, "networking")).toBe("share");
    expect(stepAfter(state, "completion")).toBeNull();
    expect(hasPendingOnboarding(null)).toBe(false);
  });

  it("defers to tomorrow morning, always in the future", () => {
    const now = new Date("2026-11-10T23:30:00");
    const until = new Date(deferUntilTomorrow(now));
    expect(until.getTime()).toBeGreaterThan(now.getTime());
    expect(until.getDate()).toBe(11);
    expect(until.getHours()).toBe(9);
  });
});

describe("onboarding after confirming a place (H15)", () => {
  const me = { profileLocked: false, dietaryLocked: false };

  it("opens the journey, returning to the application, while steps are open", async () => {
    apiGet.mockResolvedValueOnce(state);
    await expect(onboardingAfterConfirm(me, "/my-applications/4")).resolves.toBe(
      "/onboarding?next=%2Fmy-applications%2F4",
    );
  });

  it("stays put when nothing is open or the read fails", async () => {
    apiGet.mockResolvedValueOnce({ ...state, steps: [step("completion", "completed")] });
    await expect(onboardingAfterConfirm(me, "/my-applications/4")).resolves.toBeNull();
    apiGet.mockRejectedValueOnce(new Error("offline"));
    await expect(onboardingAfterConfirm(me, "/my-applications/4")).resolves.toBeNull();
  });
});
