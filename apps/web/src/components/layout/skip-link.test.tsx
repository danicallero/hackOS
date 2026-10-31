import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const translations = vi.hoisted(() => ({ skipToContent: "Saltar al contenido" }));
vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({ t: (key: keyof typeof translations) => translations[key] }),
}));

import { SkipLink } from "./skip-link";

describe("SkipLink (#1173)", () => {
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

  it("is translated, hidden until focused and targets main#main-content", () => {
    act(() => root.render(<SkipLink />));
    const link = container.querySelector("a");
    expect(link?.textContent).toBe("Saltar al contenido");
    expect(link?.getAttribute("href")).toBe("#main-content");
    expect(link?.className).toContain("sr-only");
    expect(link?.className).toContain("focus:not-sr-only");
  });

  it("focuses main without changing the URL", () => {
    act(() =>
      root.render(
        <>
          <SkipLink />
          <main id="main-content" tabIndex={-1} />
        </>,
      ),
    );
    const link = container.querySelector("a") as HTMLAnchorElement;
    const before = window.location.href;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      link.dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(container.querySelector("main"));
    expect(window.location.href).toBe(before);
  });
});
