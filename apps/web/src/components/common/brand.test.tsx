import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrandMark } from "./brand";

// #1114: a failed mark fetch must not surface as an unhandled rejection.

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

async function renderMark(fetchImpl: () => Promise<unknown>) {
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  const unhandled = vi.fn();
  window.addEventListener("unhandledrejection", unhandled);
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(<BrandMark />));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  window.removeEventListener("unhandledrejection", unhandled);
  const html = container.innerHTML;
  act(() => root.unmount());
  return { html, unhandled };
}

describe("BrandMark", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("stays blank when the fetch rejects", async () => {
    const { html, unhandled } = await renderMark(() => Promise.reject(new Error("offline")));
    expect(unhandled).not.toHaveBeenCalled();
    expect(html).not.toContain("<svg");
  });

  it("stays blank on a non-OK response", async () => {
    const { html, unhandled } = await renderMark(() =>
      Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("<svg></svg>") }),
    );
    expect(unhandled).not.toHaveBeenCalled();
    expect(html).not.toContain("<svg");
  });

  it("renders the recolored svg on success", async () => {
    const { html } = await renderMark(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve('<svg viewBox="0 0 1 1"><path style="fill:#fff"/></svg>'),
      }),
    );
    expect(html).toContain("fill:currentColor");
  });
});
