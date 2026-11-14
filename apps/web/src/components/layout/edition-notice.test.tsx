import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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

function renderNotice(): HTMLDivElement {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(<EditionNotice />);
  return container;
}

describe("EditionNotice", () => {
  it("states that a closed edition is read only, with no way to dismiss it", async () => {
    edition.value = { eventKey: "e-2025", name: "Edition 2025", status: "closed" };
    const container = renderNotice();
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "editionClosedReadOnly:Edition 2025",
    );
    expect(container.querySelector("button")).toBeNull();
  });

  it.each(["active", "draft"])("stays out of the way for a %s edition", async (status) => {
    edition.value = { eventKey: "e-2026", name: "Edition 2026", status };
    const container = renderNotice();
    expect(container.textContent).toBe("");
  });

  it("renders nothing while the edition is unknown", async () => {
    edition.value = null;
    const container = renderNotice();
    expect(container.textContent).toBe("");
  });
});
