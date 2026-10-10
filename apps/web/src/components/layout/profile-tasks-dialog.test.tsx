import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const session = vi.hoisted(() => ({
  me: null as unknown,
  refresh: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/session", () => ({ useSessionContext: () => session }));
vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
  api: { get: vi.fn(), patch: vi.fn(), put: vi.fn() },
}));
vi.mock("@/lib/i18n", () => ({
  pickText: (text: Record<string, string> | null) => text?.en ?? "",
  useLocale: () => ({
    language: "en",
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
}));
vi.mock("@/components/common/modal", () => ({
  Modal: ({
    title,
    footer,
    children,
    onOpenChange,
  }: {
    title: string;
    footer: React.ReactNode;
    children: React.ReactNode;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div role="dialog" aria-label={title}>
      <button type="button" onClick={() => onOpenChange(false)}>
        close
      </button>
      {children}
      {footer}
    </div>
  ),
}));
vi.mock("@/components/common/multi-select", () => ({ MultiSelect: () => <div /> }));

import { resetFoodIntolerancesCache } from "@/hooks/use-food-intolerances";
import { resetMealPlanStore } from "@/hooks/use-meal-plan";
import { ApiError, api } from "@/lib/api";
import { ProfileTasksDialog } from "./profile-tasks-dialog";

const baseMe = {
  id: 7,
  foodIntolerances: [],
  foodIntoleranceNotes: null,
  pendingProfileTasks: ["dietary", "meal_plan"],
};

const plan = {
  confirmedAt: null,
  cutoffHours: 24,
  meals: [
    {
      activityId: 11,
      name: "Lunch",
      nameI18n: null,
      startsAt: "2026-10-12T12:00:00.000Z",
      endsAt: "2026-10-12T13:00:00.000Z",
      location: null,
      attending: null,
      locked: false,
    },
    {
      activityId: 12,
      name: "Dinner",
      nameI18n: null,
      startsAt: "2026-10-11T19:00:00.000Z",
      endsAt: "2026-10-11T20:00:00.000Z",
      location: null,
      attending: true,
      locked: true,
    },
  ],
};

describe("ProfileTasksDialog (#933)", () => {
  let container: HTMLDivElement;
  let root: Root;
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
    resetMealPlanStore();
    resetFoodIntolerancesCache();
    session.me = { ...baseMe };
    vi.mocked(api.get).mockImplementation(async (path: string) =>
      path === "/api/me/meal-plan" ? plan : { intolerances: [] },
    );
    vi.mocked(api.patch).mockResolvedValue({});
    vi.mocked(api.put).mockResolvedValue(plan);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function render() {
    await act(async () => root.render(<ProfileTasksDialog />));
  }

  function button(name: string) {
    const match = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === name || b.getAttribute("aria-label") === name,
    );
    if (!match) throw new Error(`no button ${name}`);
    return match as HTMLButtonElement;
  }

  it("requires an explicit answer, then saves No restrictions and the meal plan", async () => {
    const user = userEvent.setup();
    await render();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();

    await user.click(button("next"));
    expect(container.textContent).toContain("dietaryAnswerRequired");
    expect(api.patch).not.toHaveBeenCalled();

    await user.click(container.querySelector('button[role="checkbox"]') as HTMLElement);
    await user.click(button("next"));
    expect(api.patch).toHaveBeenCalledWith("/api/me", {
      foodIntolerances: [],
      foodIntoleranceNotes: null,
    });

    await act(async () => {});
    // Meal step: the locked meal is disabled; tick lunch and finish.
    const boxes = [...container.querySelectorAll('button[role="checkbox"]')];
    expect(boxes).toHaveLength(2);
    expect((boxes[1] as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toContain('mealPlanLockNotice {"hours":24}');
    await user.click(boxes[0] as HTMLElement);
    await user.click(button("done"));
    expect(api.put).toHaveBeenCalledWith(
      "/api/me/meal-plan",
      {
        meals: [
          { activityId: 11, attending: true },
          { activityId: 12, attending: true },
        ],
      },
      { headers: { "idempotency-key": expect.any(String) } },
    );
    expect(session.refresh).toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("Later hides the prompt for the rest of the session", async () => {
    const user = userEvent.setup();
    await render();
    await user.click(button("later"));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(storage.get("hackos.profileTasksDismissed.7")).toBe("1");

    act(() => root.unmount());
    root = createRoot(container);
    await render();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("still opens and dismisses when sessionStorage is unavailable", async () => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    const user = userEvent.setup();
    await render();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
    await user.click(button("close"));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("stays closed with no pending tasks", async () => {
    session.me = { ...baseMe, pendingProfileTasks: [] };
    await render();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it("skips the dietary step for a locked profile (H7)", async () => {
    session.me = { ...baseMe, profileLocked: true };
    await render();
    expect(container.textContent).not.toContain("foodIntolerances");
    expect(container.textContent).toContain("meals");
    expect(container.textContent).not.toContain("stepOfTotal");
  });

  it("sends untouched notes exactly as stored", async () => {
    session.me = { ...baseMe, foodIntoleranceNotes: " Vegan " };
    const user = userEvent.setup();
    await render();
    await user.click(button("next"));
    expect(api.patch).toHaveBeenCalledWith("/api/me", {
      foodIntolerances: [],
      foodIntoleranceNotes: " Vegan ",
    });
  });

  it("disables the meal step until the plan loads, and offers a retry", async () => {
    session.me = { ...baseMe, pendingProfileTasks: ["meal_plan"] };
    let fail: (err: Error) => void = () => {};
    vi.mocked(api.get).mockImplementationOnce(
      () => new Promise((_, reject) => (fail = reject)) as never,
    );
    const user = userEvent.setup();
    await render();
    expect(button("done").disabled).toBe(true);

    await act(async () => fail(new Error("offline")));
    expect(container.textContent).toContain("couldNotLoadMealPlan");
    expect(button("done").disabled).toBe(true);

    await user.click(button("retry"));
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(button("done").disabled).toBe(false);
  });

  it("refreshes the plan and explains a closed meal when saving fails", async () => {
    session.me = { ...baseMe, pendingProfileTasks: ["meal_plan"] };
    vi.mocked(api.put).mockRejectedValueOnce(
      new ApiError(409, "meal_plan_locked", "Changes to this meal are closed"),
    );
    const user = userEvent.setup();
    await render();
    expect(api.get).toHaveBeenCalledTimes(1);
    await user.click(button("done"));
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("mealPlanLockedReview");
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("uses the meal message for other meal failures", async () => {
    session.me = { ...baseMe, pendingProfileTasks: ["meal_plan"] };
    vi.mocked(api.put).mockRejectedValueOnce(new Error("network"));
    const user = userEvent.setup();
    await render();
    await user.click(button("done"));
    expect(container.textContent).toContain("couldNotSaveMealPlan");
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("refreshes the session when closed after a saved step", async () => {
    const user = userEvent.setup();
    await render();
    await user.click(container.querySelector('button[role="checkbox"]') as HTMLElement);
    await user.click(button("next"));
    expect(session.refresh).not.toHaveBeenCalled();
    await user.click(button("later"));
    expect(session.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh the session when closed without saving", async () => {
    const user = userEvent.setup();
    await render();
    await user.click(button("later"));
    expect(session.refresh).not.toHaveBeenCalled();
  });
});
