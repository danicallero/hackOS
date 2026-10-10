import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MealPlanSection, type StaffMealPlan } from "./meal-plan-section";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), canManage: true }));

vi.mock("@/lib/api", () => ({
  api: { get: mocks.get, put: mocks.put },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
    ) {
      super(code);
    }
  },
}));
vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({ t: (key: string) => key, language: "en" }),
  pickText: (text: Record<string, string> | null) => text?.en ?? "",
}));
vi.mock("@/lib/session", () => ({ useCan: () => mocks.canManage }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/common/contextual-error", () => ({
  ContextualError: ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
    <div role="alert">
      {message}
      <button type="button" data-retry onClick={onRetry} />
    </div>
  ),
}));
vi.mock("@/components/common/section-card", () => ({
  SectionCard: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) => (
    <div>
      {footer}
      {children}
    </div>
  ),
}));

const PLAN: StaffMealPlan = {
  confirmedAt: null,
  meals: [
    {
      activityId: 1,
      name: "Lunch",
      nameI18n: null,
      startsAt: "2026-10-20T12:00:00.000Z",
      attending: true,
      locked: false,
    },
    {
      activityId: 2,
      name: "Breakfast",
      nameI18n: null,
      startsAt: "2026-10-11T08:00:00.000Z",
      attending: false,
      locked: true,
    },
  ],
};

describe("MealPlanSection (#933)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.canManage = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    mocks.get.mockReset();
    mocks.put.mockReset();
  });

  async function render(userId = 7) {
    await act(async () => {
      root.render(<MealPlanSection userId={userId} />);
      await Promise.resolve();
    });
  }

  const boxes = () => [...container.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')];
  const save = () =>
    container.querySelector<HTMLButtonElement>("button:not([role]):not([data-retry])");

  it("renders nothing for a non-sponsor", async () => {
    const { ApiError } = await import("@/lib/api");
    mocks.get.mockRejectedValue(new ApiError(403, "not_sponsor", "not_sponsor"));
    await render();
    expect(container.textContent).toBe("");
  });

  it("shows other load failures with a retry", async () => {
    mocks.get.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(PLAN);
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "couldNotLoadMealPlan",
    );
    await act(async () => container.querySelector<HTMLButtonElement>("[data-retry]")?.click());
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(boxes()).toHaveLength(2);
  });

  it("clears the previous user's plan when the user changes", async () => {
    let resolveNext: (plan: StaffMealPlan) => void = () => undefined;
    mocks.get
      .mockResolvedValueOnce(PLAN)
      .mockReturnValueOnce(new Promise((resolve) => (resolveNext = resolve)));
    await render(7);
    expect(boxes()).toHaveLength(2);
    await render(8);
    expect(mocks.get).toHaveBeenLastCalledWith("/api/users/8/meal-plan");
    expect(boxes()).toHaveLength(0);
    await act(async () => resolveNext({ ...PLAN, meals: [PLAN.meals[0]] }));
    expect(boxes()).toHaveLength(1);
  });

  it("keeps unanswered meals unanswered and sends only explicit answers", async () => {
    const unanswered = { ...PLAN.meals[0], activityId: 3, attending: null };
    mocks.get.mockResolvedValue({ ...PLAN, meals: [PLAN.meals[0], unanswered] });
    mocks.put.mockResolvedValue({ ...PLAN, meals: [PLAN.meals[0], unanswered] });
    await render();
    expect(container.textContent).toContain("columnUnanswered");
    // Nothing edited: an unanswered meal alone does not make the form dirty.
    expect(save()?.disabled).toBe(true);

    await act(async () => boxes()[1]?.click());
    expect(container.textContent).not.toContain("columnUnanswered");
    await act(async () => save()?.click());
    expect(mocks.put).toHaveBeenCalledWith(
      "/api/users/7/meal-plan",
      { meals: [{ activityId: 3, attending: true }] },
      expect.anything(),
    );
  });

  it("is clean again after reverting an edit", async () => {
    mocks.get.mockResolvedValue(PLAN);
    await render();
    await act(async () => boxes()[0]?.click());
    expect(save()?.disabled).toBe(false);
    await act(async () => boxes()[0]?.click());
    expect(save()?.disabled).toBe(true);
  });

  it("submits open meals only, keeping locked meals read-only", async () => {
    mocks.get.mockResolvedValue(PLAN);
    mocks.put.mockResolvedValue({
      ...PLAN,
      meals: [{ ...PLAN.meals[0], attending: false }, PLAN.meals[1]],
    });
    await render();
    expect(mocks.get).toHaveBeenCalledWith("/api/users/7/meal-plan");
    expect(boxes()[1]?.disabled).toBe(true);
    expect(save()?.disabled).toBe(true);

    await act(async () => boxes()[0]?.click());
    expect(save()?.disabled).toBe(false);
    await act(async () => save()?.click());

    expect(mocks.put).toHaveBeenCalledWith(
      "/api/users/7/meal-plan",
      { meals: [{ activityId: 1, attending: false }] },
      expect.anything(),
    );
  });

  it("is read-only without meal-plans:manage", async () => {
    mocks.canManage = false;
    mocks.get.mockResolvedValue(PLAN);
    await render();
    expect(boxes().every((box) => box.disabled)).toBe(true);
    expect(save()).toBeNull();
  });
});
