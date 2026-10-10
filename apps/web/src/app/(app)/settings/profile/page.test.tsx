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
  ApiError: class ApiError extends Error {},
  api: { get: vi.fn(), patch: vi.fn() },
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/i18n", () => ({
  languageName: (lang: string) => lang,
  pickText: (text: Record<string, string> | null) => text?.en ?? "",
  useLocale: () => ({ language: "en", t: (key: string) => key }),
}));
vi.mock("@/lib/use-unsaved-changes-guard", () => ({ useUnsavedChangesGuard: () => {} }));
vi.mock("@/hooks/use-shirt-sizes", () => ({ useShirtSizes: () => ["M"] }));
vi.mock("@/hooks/use-food-intolerances", () => ({
  useFoodIntolerances: () => [{ id: 3, label: { en: "Gluten" }, description: null }],
}));
vi.mock("@/components/common/multi-select", () => ({
  MultiSelect: ({
    value,
    onChange,
    disabled,
  }: {
    value: string[];
    onChange: (value: string[]) => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      data-testid="intolerances"
      data-value={value.join(",")}
      disabled={disabled}
      onClick={() => onChange([])}
    >
      clear
    </button>
  ),
}));
vi.mock("@/components/common/page-layout", () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/common/page-header", () => ({ PageHeader: () => null }));
vi.mock("@/components/common/form-actions", () => ({
  FormActions: () => <button type="submit">save</button>,
}));
vi.mock("@/components/common/section-card", () => ({
  SectionCard: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) => (
    <section>
      {children}
      {footer}
    </section>
  ),
}));
vi.mock("./danger-zone", () => ({ DangerZoneCard: () => null }));
vi.mock("./email-card", () => ({ EmailCard: () => null }));
vi.mock("./password-card", () => ({ PasswordCard: () => null }));
vi.mock("./meals-section", () => ({ MealsSection: () => null }));

import { api } from "@/lib/api";
import ProfileSettingsPage from "./page";

const baseMe = {
  id: 7,
  name: "Ana",
  surname: "Pérez",
  language: "en",
  shirtSize: "M",
  foodIntolerances: [3],
  foodIntoleranceNotes: "No nuts",
  dietaryConfirmedAt: "2026-10-01T00:00:00.000Z",
  profileLocked: false,
  isSponsorRep: false,
  capabilities: [],
  roles: [],
};

describe("My profile dietary answer (#933)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    session.me = { ...baseMe };
    vi.mocked(api.patch).mockResolvedValue({});
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
    await act(async () => root.render(<ProfileSettingsPage />));
  }

  const noneBox = () => container.querySelector('button[role="checkbox"]') as HTMLButtonElement;
  const notes = () => container.querySelector("textarea") as HTMLTextAreaElement;
  const picker = () => container.querySelector('[data-testid="intolerances"]') as HTMLElement;
  const save = () =>
    [...container.querySelectorAll("button")].find((b) => b.textContent === "save") as HTMLElement;

  it("refuses an empty answer that is not No restrictions", async () => {
    const user = userEvent.setup();
    await render();
    await user.click(picker());
    await user.clear(notes());
    await user.click(save());
    expect(container.textContent).toContain("dietaryAnswerRequired");
    expect(api.patch).not.toHaveBeenCalled();

    await user.click(noneBox());
    await user.click(save());
    expect(api.patch).toHaveBeenCalledWith(
      "/api/me",
      expect.objectContaining({ foodIntolerances: [], foodIntoleranceNotes: null }),
    );
  });

  it("restores the previous answer when No restrictions is unticked", async () => {
    const user = userEvent.setup();
    await render();
    await user.click(noneBox());
    expect(picker().dataset.value).toBe("");
    expect(notes().value).toBe("");

    await user.click(noneBox());
    expect(picker().dataset.value).toBe("3");
    expect(notes().value).toBe("No nuts");
  });
});
