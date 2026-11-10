import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RsvpItem } from "@/lib/rsvp";
import { CateringRsvpForm } from "./catering-rsvp";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({ t: (key: string) => key, language: "en" }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/datetime", () => ({ formatEventDate: () => "date" }));
vi.mock("@/components/common/contextual-error", () => ({
  ContextualError: ({ message }: { message: string }) => <div role="alert">{message}</div>,
}));
vi.mock("@/components/common/form-actions", () => ({
  FormActions: ({
    disabled,
    secondaryActions,
  }: {
    disabled?: boolean;
    secondaryActions?: React.ReactNode;
  }) => (
    <div>
      {secondaryActions}
      <button type="submit" data-submit disabled={disabled}>
        save
      </button>
    </div>
  ),
}));
vi.mock("@/components/common/section-card", () => ({
  SectionCard: ({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}));

function item(overrides: Partial<RsvpItem>): RsvpItem {
  return {
    activityId: 1,
    name: "Lunch",
    description: null,
    date: "2026-10-20T12:00:00.000Z",
    closesAt: "2026-10-19T12:00:00.000Z",
    location: null,
    required: false,
    options: [],
    answer: null,
    optionKey: null,
    optionLabel: null,
    allowsUnsure: true,
    optionRetired: false,
    locked: false,
    isMeal: true,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function radio(group: string, label: string): HTMLButtonElement {
  const g = container.querySelector(`[role=radiogroup][aria-label="${group}"]`);
  const found = [...(g?.querySelectorAll<HTMLButtonElement>("[role=radio]") ?? [])].find(
    (b) => b.textContent === label,
  );
  if (!found) throw new Error(`no ${label} in ${group}`);
  return found;
}
const click = (el: Element) =>
  act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const submit = () =>
  container.querySelector<HTMLButtonElement>("[data-submit]") as HTMLButtonElement;

function render(items: RsvpItem[], save = vi.fn().mockResolvedValue(undefined)) {
  act(() => root.render(<CateringRsvpForm items={items} save={save} />));
  return save;
}

describe("CateringRsvpForm", () => {
  it("puts the host's actions beside Save", () => {
    act(() =>
      root.render(
        <CateringRsvpForm
          items={[item({})]}
          save={vi.fn()}
          actions={<button type="button">later</button>}
        />,
      ),
    );
    expect(container.textContent).toContain("later");
  });

  it("lets an optional item be skipped and sends only what changed", async () => {
    const save = render([item({ activityId: 1 }), item({ activityId: 2, name: "Dinner" })]);
    click(radio("Dinner", "rsvpUnsure"));
    await act(async () => submit().click());
    expect(save).toHaveBeenCalledTimes(1);
    const draft = save.mock.calls[0][1];
    expect(draft[1].answer).toBeNull();
    expect(draft[2].answer).toBe("unsure");
  });

  it("blocks a required item until answered and hides unsure when not allowed", () => {
    render([item({ required: true, allowsUnsure: false })]);
    expect(submit().disabled).toBe(true);
    const labels = [...container.querySelectorAll("[role=radio]")].map((b) => b.textContent);
    expect(labels).toEqual(["rsvpYes", "rsvpNo"]);
    click(radio("Lunch", "rsvpNo"));
    expect(submit().disabled).toBe(false);
  });

  it("asks for an option after yes and clears it on no", () => {
    render([
      item({
        options: [
          { key: "veg", label: "Vegetarian" },
          { key: "std", label: "Standard" },
        ],
      }),
    ]);
    expect(container.querySelector("[aria-label=rsvpOption]")).toBeNull();
    click(radio("Lunch", "rsvpYes"));
    expect(submit().disabled).toBe(true);
    click(radio("rsvpOption", "Vegetarian"));
    expect(submit().disabled).toBe(false);
    click(radio("Lunch", "rsvpNo"));
    expect(container.querySelector("[aria-label=rsvpOption]")).toBeNull();
  });

  it("shows a retired stored option and demands a live one", () => {
    render([
      item({
        options: [{ key: "std", label: "Standard" }],
        answer: "yes",
        optionKey: "veg",
        optionLabel: "Vegetarian",
        optionRetired: true,
      }),
    ]);
    expect(container.textContent).toContain("Vegetarian · rsvpOptionRetired");
    expect(submit().disabled).toBe(true);
    click(radio("rsvpOption", "Standard"));
    expect(submit().disabled).toBe(false);
  });

  it("makes a locked item read-only", () => {
    render([item({ locked: true, required: true, answer: "no" })]);
    for (const button of container.querySelectorAll<HTMLButtonElement>("[role=radio]")) {
      expect(button.disabled).toBe(true);
    }
    expect(submit().disabled).toBe(false);
    expect(container.textContent).toContain("rsvpClosed");
  });
});
