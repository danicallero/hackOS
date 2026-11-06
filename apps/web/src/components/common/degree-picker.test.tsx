import { getByRole } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DegreePicker } from "./degree-picker";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: { get } }));
vi.mock("@/lib/server-state", () => ({
  readServerState: (_key: unknown, load: (signal: AbortSignal) => unknown) =>
    load(new AbortController().signal),
}));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/session", () => ({ useSessionContext: () => ({ status: "authenticated" }) }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn() } }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  get.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function show(value: string) {
  await act(async () => root.render(<DegreePicker value={value} onChange={() => {}} disabled />));
}

it("resolves the degree when navigating forward, back and to an empty answer", async () => {
  get.mockImplementation((_path, { query }) =>
    Promise.resolve({
      degrees: [{ id: Number(query.ids), name: query.ids === "1" ? "Engineering" : "Mathematics" }],
    }),
  );
  await show("1");
  expect(getByRole(host, "combobox").textContent).toBe("Engineering");
  await show("2");
  expect(getByRole(host, "combobox").textContent).toBe("Mathematics");
  await show("1");
  expect(getByRole(host, "combobox").textContent).toBe("Engineering");
  await show("");
  expect(getByRole(host, "combobox").textContent).toBe("selectDegreePlaceholder");
});

it("ignores a late degree lookup from the previous response", async () => {
  let finishFirst!: (result: { degrees: { id: number; name: string }[] }) => void;
  get.mockImplementation((_path, { query }) =>
    query.ids === "1"
      ? new Promise((resolve) => {
          finishFirst = resolve;
        })
      : Promise.resolve({ degrees: [{ id: 2, name: "Mathematics" }] }),
  );
  await show("1");
  await show("2");
  expect(getByRole(host, "combobox").textContent).toBe("Mathematics");
  await act(async () => finishFirst({ degrees: [{ id: 1, name: "Engineering" }] }));
  expect(getByRole(host, "combobox").textContent).toBe("Mathematics");
});
