import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const edition = vi.hoisted(() => ({
  value: null as { eventKey: string; name: string; status: string } | null,
}));

vi.mock("@/hooks/use-editions", () => ({ useViewedEdition: () => edition.value }));
vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string, values?: Record<string, string>) => `${key}:${values?.name ?? ""}`,
  }),
}));

import { EditionNotice } from "./edition-notice";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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

describe("EditionNotice", () => {
  it("states that a closed edition is read only, with no way to dismiss it", async () => {
    edition.value = { eventKey: "e-2025", name: "Edition 2025", status: "closed" };
    await act(async () => root.render(<EditionNotice />));
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "editionClosedReadOnly:Edition 2025",
    );
    expect(container.querySelector("button")).toBeNull();
  });

  it.each(["active", "draft"])("stays out of the way for a %s edition", async (status) => {
    edition.value = { eventKey: "e-2026", name: "Edition 2026", status };
    await act(async () => root.render(<EditionNotice />));
    expect(container.textContent).toBe("");
  });

  it("renders nothing while the edition is unknown", async () => {
    edition.value = null;
    await act(async () => root.render(<EditionNotice />));
    expect(container.textContent).toBe("");
  });
});
