import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicationSummary } from "./publication-summary";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("@/lib/i18n", () => ({
  LOCALE_CODES: { en: "en-GB" },
  useLocale: () => ({ language: "en", t: (key: string) => key }),
}));

describe("PublicationSummary (#928)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => act(() => root.unmount()));

  it("shows a hidden enterprise's reveal date", () => {
    act(() =>
      root.render(
        <PublicationSummary
          enterprise={{ visibility: "hidden", available_from: "2030-05-01T10:00:00Z" }}
        />,
      ),
    );
    expect(container.textContent).toContain("hiddenOption");
    expect(container.textContent).toContain("publishAtLabel");
    expect(container.textContent).toContain("2030");
  });

  it("shows only visibility once published", () => {
    act(() =>
      root.render(
        <PublicationSummary
          enterprise={{ visibility: "visible", available_from: "2020-05-01T10:00:00Z" }}
        />,
      ),
    );
    expect(container.textContent).toContain("visibleLabel");
    expect(container.textContent).not.toContain("publishAtLabel");
  });
});
