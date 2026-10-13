import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
      public details?: unknown,
    ) {
      super(message);
    }
  },
  api: { get: vi.fn(), put: vi.fn() },
}));

import { ApiError, api } from "@/lib/api";
import type { MealPlan } from "@/lib/meal-plan";
import { resetServerStateForTests } from "@/lib/server-state";
import { mealPlanSaveErrorKey, useMealPlan } from "./use-meal-plan";

const meal = {
  activityId: 11,
  name: "Lunch",
  nameI18n: null,
  startsAt: "2026-10-12T12:00:00.000Z",
  endsAt: "2026-10-12T13:00:00.000Z",
  location: null,
  attending: null,
  locked: false,
};
const plan: MealPlan = { confirmedAt: null, cutoffHours: 24, meals: [meal] };

type Hook = ReturnType<typeof useMealPlan>;

describe("useMealPlan (#933)", () => {
  let container: HTMLDivElement;
  let root: Root;
  const seen: Record<string, Hook> = {};

  function Probe({ name }: { name: string }) {
    seen[name] = useMealPlan(7);
    return null;
  }

  beforeEach(() => {
    resetServerStateForTests();
    vi.mocked(api.get).mockResolvedValue(plan);
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.clearAllMocks();
  });

  it("shares one plan between the prompt and My profile", async () => {
    await act(async () =>
      root.render(
        <>
          <Probe name="dialog" />
          <Probe name="profile" />
        </>,
      ),
    );
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(seen.profile.plan).toEqual(plan);

    const saved = { ...plan, meals: [{ ...meal, attending: true }] };
    vi.mocked(api.put).mockResolvedValue(saved);
    await act(async () => {
      await seen.dialog.save(plan, { 11: true });
    });
    expect(seen.profile.plan).toEqual(saved);
  });

  it("reloads the plan when a save fails because the offered meals changed", async () => {
    await act(async () => root.render(<Probe name="profile" />));
    expect(api.get).toHaveBeenCalledTimes(1);
    // The API's actual shape: a generic 409 whose details name the reason.
    const locked = new ApiError(409, "conflict", "Changes to this meal are closed", {
      code: "meal_plan_locked",
    });
    vi.mocked(api.put).mockRejectedValueOnce(locked);
    await act(async () => {
      await expect(seen.profile.save(plan, { 11: true })).rejects.toBe(locked);
    });
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("does not reload after an unrelated failure", async () => {
    await act(async () => root.render(<Probe name="profile" />));
    vi.mocked(api.put).mockRejectedValueOnce(new ApiError(400, "bad_request", "Invalid body"));
    await act(async () => {
      await expect(seen.profile.save(plan, { 11: true })).rejects.toBeInstanceOf(ApiError);
    });
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});

describe("mealPlanSaveErrorKey (#933)", () => {
  const failure = (code: string) => new ApiError(400, "bad_request", code, { code });

  it("explains each domain reason the API sends in details", () => {
    expect(mealPlanSaveErrorKey(failure("meal_plan_incomplete"))).toBe("mealPlanChangedReview");
    expect(mealPlanSaveErrorKey(failure("meal_plan_locked"))).toBe("mealPlanLockedReview");
    expect(mealPlanSaveErrorKey(failure("meal_not_offered"))).toBe("mealPlanChangedReview");
  });

  it("falls back to the generic message", () => {
    expect(mealPlanSaveErrorKey(new ApiError(400, "bad_request", "Invalid body"))).toBe(
      "couldNotSaveMealPlan",
    );
    expect(mealPlanSaveErrorKey(new Error("network"))).toBe("couldNotSaveMealPlan");
  });
});
