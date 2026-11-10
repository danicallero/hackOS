import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RsvpSettings } from "@/lib/rsvp";
import { CateringSettingsPanel } from "./catering-settings";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mocks = vi.hoisted(() => ({ save: vi.fn(), settings: null as RsvpSettings | null }));

vi.mock("@/hooks/use-rsvp-settings", () => ({
  useRsvpSettings: () => ({
    settings: mocks.settings,
    loadError: false,
    reload: vi.fn(),
    save: mocks.save,
  }),
}));
vi.mock("@/lib/i18n", () => ({
  LANGS: ["es", "gl", "en"],
  languageName: (l: string) => l,
  useLocale: () => ({ t: (key: string) => key, language: "en" }),
}));
vi.mock("@/lib/datetime", () => ({
  toDatetimeLocal: (iso: string | null) => (iso ? iso.slice(0, 16) : ""),
  fromDatetimeLocal: (v: string) => (v ? `${v}:00.000Z` : null),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/common/datetime-input", () => ({
  DateTimeInput: ({ value }: { value: string }) => <input readOnly value={value} />,
}));
vi.mock("@/components/common/contextual-error", () => ({
  ContextualError: ({ message }: { message: string }) => <div role="alert">{message}</div>,
}));
vi.mock("@/components/common/form-actions", () => ({
  FormActions: ({ disabled }: { disabled?: boolean }) => (
    <button type="submit" data-submit disabled={disabled}>
      save
    </button>
  ),
}));

function settings(overrides: Partial<RsvpSettings> = {}): RsvpSettings {
  return {
    activityId: 7,
    scheduleId: 3,
    isMeal: true,
    enabled: true,
    kinds: ["sponsor"],
    nameI18n: null,
    descriptionI18n: null,
    rsvpDate: null,
    closesAt: null,
    defaults: { name: "Lunch", description: null, date: "2026-10-20T12:00:00.000Z", closesAt: "x" },
    counts: {
      activityId: 7,
      scheduleId: 3,
      name: "Lunch",
      nameI18n: {},
      startsAt: "x",
      isMeal: true,
      eligible: 4,
      attending: 2,
      notAttending: 1,
      unsure: 1,
      unanswered: 0,
      byKind: {},
      intolerances: [],
      withNotes: 0,
    },
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  // Radix size observers need ResizeObserver, which the test DOM lacks.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  mocks.save.mockReset().mockResolvedValue(settings());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(s: RsvpSettings) {
  mocks.settings = s;
  act(() => root.render(<CateringSettingsPanel scheduleId={3} />));
}

describe("CateringSettingsPanel", () => {
  it("never offers participants for a meal, but does for other activities", () => {
    render(settings());
    expect(container.textContent).not.toContain("rsvpKindParticipant");
    expect(container.textContent).toContain("rsvpMealsNoParticipants");
    expect(container.textContent).not.toContain("rsvpRequired");
    act(() => root.unmount());
    root = createRoot(container);
    render(settings({ isMeal: false }));
    expect(container.textContent).toContain("rsvpKindParticipant");
  });

  it("shows counts and saves the draft body", async () => {
    render(settings());
    expect(container.textContent).toContain("rsvpUnsure");
    await act(async () => container.querySelector<HTMLButtonElement>("[data-submit]")?.click());
    expect(mocks.save).toHaveBeenCalledWith({
      enabled: true,
      kinds: ["sponsor"],
      nameI18n: null,
      descriptionI18n: null,
      rsvpDate: null,
      closesAt: null,
    });
  });

  it("blocks saving an enabled RSVP that asks nobody", () => {
    render(settings({ kinds: [] }));
    expect(container.querySelector<HTMLButtonElement>("[data-submit]")?.disabled).toBe(true);
    expect(container.textContent).toContain("rsvpKindsRequired");
  });
});
