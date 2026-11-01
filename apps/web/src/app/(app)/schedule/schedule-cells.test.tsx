import { getByRole } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logisticsApi, type PublicScheduleItem } from "@/lib/logistics";
import { toast } from "@/lib/toast";
import { EditableOwnersCell, EditableTextCell, EditableTimeCell } from "./schedule-cells";

// #1118: owner add/remove failures must be reported, not left unhandled.

vi.mock("@/lib/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/i18n")>()),
  useLocale: () => ({ t: (key: string) => key, language: "en" }),
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/common/user-picker", () => ({ UserPicker: () => null }));
vi.mock("@/lib/logistics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logistics")>();
  return {
    ...actual,
    logisticsApi: {
      ...actual.logisticsApi,
      addScheduleOwner: vi.fn(),
      removeScheduleOwner: vi.fn(),
    },
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const item = {
  id: 7,
  title: "Workshop",
  owners: [{ id: 3, userId: null, freeTextName: "Ana" }],
} as unknown as PublicScheduleItem;

async function openCell() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(<EditableOwnersCell item={item} onUpdate={vi.fn()} />));
  await act(async () => {
    container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  return () => {
    act(() => root.unmount());
    container.remove();
  };
}

async function click(el: Element | null) {
  await act(async () => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("EditableOwnersCell", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reports a failed add and keeps the typed name", async () => {
    vi.mocked(logisticsApi.addScheduleOwner).mockRejectedValue(new Error("boom"));
    const cleanup = await openCell();
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="ownerFreeTextPlaceholder"]',
    );
    expect(input).not.toBeNull();
    expect(input?.getAttribute("aria-label")).toBe("ownerFreeTextPlaceholder");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "Luis");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const add = [...document.querySelectorAll("button")].filter(
      (b) => b.textContent === "addAction",
    )[1];
    await click(add);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(input?.value).toBe("Luis");
    cleanup();
  });

  it("reports a failed remove", async () => {
    vi.mocked(logisticsApi.removeScheduleOwner).mockRejectedValue(new Error("boom"));
    const cleanup = await openCell();
    await click(document.querySelector('[aria-label="remove"]'));
    expect(toast.error).toHaveBeenCalledTimes(1);
    cleanup();
  });
});

describe("schedule inline editor accessible names (H59)", () => {
  for (const kind of ["text", "time"] as const) {
    it(`names the ${kind} editor and preserves keyboard save/cancel`, async () => {
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      const onSave = vi.fn().mockResolvedValue(true);
      const user = userEvent.setup();
      const fieldLabel = kind === "text" ? "Notes" : "Starts";
      const value = kind === "text" ? "Existing notes" : "09:00";
      act(() =>
        root.render(
          kind === "text" ? (
            <EditableTextCell value={value} fieldLabel={fieldLabel} onSave={onSave} />
          ) : (
            <EditableTimeCell value={value} fieldLabel={fieldLabel} onSave={onSave} />
          ),
        ),
      );
      try {
        const trigger = getByRole(container, "button", { name: `editScheduleFieldAria: ${value}` });
        trigger.focus();
        await act(async () => {
          await user.keyboard("{Enter}");
        });
        const input = getByRole(container, "textbox", { name: fieldLabel });
        expect(document.activeElement).toBe(input);
        await act(async () => {
          await user.clear(input);
          await user.type(input, kind === "text" ? "Updated" : "10:30");
          await user.keyboard("{Enter}");
        });
        expect(onSave).toHaveBeenCalledWith(kind === "text" ? "Updated" : "10:30");
        getByRole(container, "button").focus();
        await act(async () => {
          await user.keyboard("{Enter}");
        });
        await act(async () => {
          await user.keyboard("{Escape}");
        });
        expect(container.querySelector("input")).toBeNull();
        expect(onSave).toHaveBeenCalledTimes(1);
      } finally {
        act(() => root.unmount());
        container.remove();
      }
    });
  }
});
