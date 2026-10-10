import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: { get: vi.fn(), put: vi.fn() },
}));

import { api } from "@/lib/api";
import type { MealPlan } from "@/lib/meal-plan";
import { resetMealPlanStore, useMealPlan } from "./use-meal-plan";

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
    resetMealPlanStore();
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
});
