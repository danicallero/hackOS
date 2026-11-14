import type { TvConnectionEdge, TvConnectionNode } from "@hackos/shared/tv-connections";
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

// jsdom has no layout: hand the graph a fixed portrait-ish box.
vi.mock("@/hooks/use-element-size", () => ({
  useElementSize: () => ({ ref: useRef(null), width: 1080, height: 1400 }),
}));

import { ConnectionsGraph, logoCandidates } from "./connections-graph";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("ConnectionsGraph", () => {
  it("(setup) stubs the 2D context jsdom lacks", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      measureText: () => ({ width: 6 }),
      clearRect: () => undefined,
      fillRect: () => undefined,
      getImageData: () => ({ data: [20, 40, 200, 255] }),
    } as unknown as CanvasRenderingContext2D);
  });

  it("renders a dense 520-node graph as SVG without throwing", async () => {
    const nodes: TvConnectionNode[] = Array.from({ length: 520 }, (_, i) => ({
      id: `n${i}`,
      kind: i % 40 === 0 ? "company" : "person",
      label: i % 2 ? (null as unknown as string) : `Name ${i}`,
      degree: 2,
    }));
    const edges: TvConnectionEdge[] = nodes.slice(1).map((node, i) => ({
      source: node.id,
      target: `n${(i * 7) % 520}`,
    }));
    const container = document.createElement("div");
    container.style.cssText = "width:1080px;height:1400px";
    document.body.append(container);
    const root = createRoot(container);
    const started = performance.now();
    await act(async () =>
      root.render(<ConnectionsGraph nodes={nodes} edges={edges} label="graph" />),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.querySelectorAll("path").length).toBeGreaterThan(500);
    expect(svg?.querySelectorAll("circle").length).toBeGreaterThanOrEqual(520);
    expect(container.querySelector("[data-testid=connections-caption]")).toBeNull();
    expect(performance.now() - started).toBeLessThan(5_000);
    act(() => root.unmount());
    container.remove();
  });

  it("picks the negative logo on dark and falls back to the plain one", () => {
    const co = {
      id: "c",
      kind: "company" as const,
      label: "Acme",
      degree: 2,
      logoUrl: "https://x/a.png",
      logoNegativeUrl: "https://x/a-neg.png",
    };
    expect(logoCandidates(co, true)).toEqual(["https://x/a-neg.png", "https://x/a.png"]);
    expect(logoCandidates(co, false)).toEqual(["https://x/a.png"]);
    expect(logoCandidates({ ...co, logoNegativeUrl: co.logoUrl }, true)).toEqual([co.logoUrl]);
    expect(logoCandidates({ ...co, logoUrl: null, logoNegativeUrl: null }, true)).toEqual([]);
  });

  it("draws a company without a logo as a neutral disc with its initial", async () => {
    const nodes: TvConnectionNode[] = [
      { id: "c", kind: "company", label: "acme", degree: 2, logoUrl: null, logoNegativeUrl: null },
      { id: "a", kind: "person", label: "Ana", degree: 1 },
      { id: "b", kind: "person", label: "Bo", degree: 1 },
    ];
    const edges = [
      { source: "a", target: "c" },
      { source: "b", target: "c" },
    ];
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(<ConnectionsGraph nodes={nodes} edges={edges} label="graph" />),
    );
    const company = container.querySelector("[data-company]");
    expect(company?.querySelector("image")).toBeNull();
    expect(company?.querySelector("text")?.textContent).toBe("A");
    act(() => root.unmount());
    container.remove();
  });
});
