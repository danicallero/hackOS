import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import { resetServerStateForTests } from "@/lib/server-state";
import { EditionsTab } from "./editions-tab";

const refresh = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn() },
  ApiError: class ApiError extends Error {},
}));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/session", () => ({ useSessionContext: () => ({ refresh }) }));
const t = (key: string, values?: Record<string, string | number>) =>
  values ? Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), key) : key;
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t, language: "en" }) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
  StubResizeObserver as unknown as typeof ResizeObserver;

const edition = (eventKey: string, status: "draft" | "active" | "closed") => ({
  eventKey,
  name: `Name ${eventKey}`,
  status,
  startsAt: null,
  endsAt: null,
  isCurrent: status === "active",
});

let container: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => root.render(<EditionsTab />));
}

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!match) throw new Error(`no button "${label}"`);
  return match;
}

beforeEach(() => {
  resetServerStateForTests();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(api.get).mockResolvedValue({
    items: [edition("e-2027", "draft"), edition("e-2026", "active"), edition("e-2025", "closed")],
  });
  vi.mocked(api.post).mockResolvedValue({});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.mocked(api.get).mockReset();
  vi.mocked(api.post).mockReset();
  refresh.mockClear();
});

describe("EditionsTab", () => {
  it("offers the action each status allows", async () => {
    await render();
    expect(vi.mocked(api.get).mock.calls[0][0]).toBe("/api/editions");
    expect(button("editionMakeCurrent")).toBeTruthy();
    expect(button("editionClose")).toBeTruthy();
    expect(button("editionReopen")).toBeTruthy();
  });

  it("makes a draft current and refreshes session facts", async () => {
    await render();
    const user = userEvent.setup();
    await act(async () => user.click(button("editionMakeCurrent")));
    expect(api.post).toHaveBeenCalledWith("/api/editions/e-2027/activate");
    expect(refresh).toHaveBeenCalled();
  });

  it("reopens a closed edition", async () => {
    await render();
    const user = userEvent.setup();
    await act(async () => user.click(button("editionReopen")));
    expect(api.post).toHaveBeenCalledWith("/api/editions/e-2025/reopen");
  });

  it("closes only after the consequences are confirmed", async () => {
    await render();
    const user = userEvent.setup();
    await act(async () => user.click(button("editionClose")));
    expect(api.post).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("editionCloseConsequences");
    const confirm = [...document.querySelectorAll('[role="alertdialog"] button')].find(
      (b) => b.textContent?.trim() === "editionClose",
    ) as HTMLElement;
    await act(async () => user.click(confirm));
    expect(api.post).toHaveBeenCalledWith("/api/editions/e-2026/close");
  });

  it("creates a draft edition from key and name, leaving dates out when blank", async () => {
    await render();
    const user = userEvent.setup();
    await act(async () => user.click(button("editionCreate")));
    const inputs = document.querySelectorAll<HTMLInputElement>('[role="dialog"] input');
    await act(async () => user.type(inputs[0], "Edition 2028"));
    await act(async () => user.type(inputs[1], "e-2028"));
    const submit = document.querySelector<HTMLButtonElement>(
      '[role="dialog"] button[type="submit"]',
    );
    await act(async () => user.click(submit as HTMLElement));
    expect(api.post).toHaveBeenCalledWith("/api/editions", {
      eventKey: "e-2028",
      name: "Edition 2028",
    });
  });
});
