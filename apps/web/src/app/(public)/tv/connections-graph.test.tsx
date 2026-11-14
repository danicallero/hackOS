import type { TvConnectionEdge, TvConnectionNode } from "@hackos/shared/tv-connections";
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

// jsdom has no layout: hand the graph a fixed portrait-ish box.
vi.mock("@/hooks/use-element-size", () => ({
  useElementSize: () => ({ ref: useRef(null), width: 1080, height: 1400 }),
}));

import {
  ConnectionsGraph,
  logoCandidates,
  MOVE_MS,
  OVERVIEW_DWELL_MS,
  TOP_LABELS,
} from "./connections-graph";

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
    expect(svg?.querySelectorAll("line").length).toBeGreaterThan(500);
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
    // No company name label anywhere; glow gradients are gone too.
    expect(container.textContent).not.toContain("acme");
    expect(container.querySelector("radialGradient, filter, path")).toBeNull();
    act(() => root.unmount());
    container.remove();
  });

  it("keeps every node element during a camera tween and names only the top people", async () => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
        "performance",
      ],
    });
    try {
      const nodes: TvConnectionNode[] = [];
      const edges: TvConnectionEdge[] = [];
      for (let c = 0; c < 3; c++) {
        nodes.push({ id: `co${c}`, kind: "company", label: `Co ${c}`, degree: 8, logoUrl: null });
        for (let i = 0; i < 8; i++) {
          nodes.push({ id: `p${c}-${i}`, kind: "person", label: `Person ${c}-${i}`, degree: 3 });
          edges.push({ source: `p${c}-${i}`, target: `co${c}` });
          edges.push({ source: `p${c}-${i}`, target: `p${c}-${(i + 1) % 8}` });
          edges.push({ source: `p${c}-${i}`, target: `p${c}-${(i + 3) % 8}` });
        }
      }
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      await act(async () =>
        root.render(<ConnectionsGraph nodes={nodes} edges={edges} label="graph" />),
      );
      const before = [...container.querySelectorAll("[data-nid], line")];
      expect(before.length).toBeGreaterThan(60);
      const mutations: number[] = [];
      const observer = new MutationObserver((records) => {
        mutations.push(
          ...records
            .filter((r) => r.type === "childList")
            .map((r) => r.addedNodes.length + r.removedNodes.length),
        );
      });
      const svgRoot = container.querySelector("svg g");
      if (svgRoot) observer.observe(svgRoot, { subtree: true, childList: true });
      // Step into the first section, frame by frame.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(OVERVIEW_DWELL_MS + MOVE_MS + 100);
      });
      for (let t = 0; t < 40; t++)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(50);
        });
      const after = [...container.querySelectorAll("[data-nid], line")];
      expect(after).toHaveLength(before.length);
      for (let i = 0; i < before.length; i++) expect(after[i]).toBe(before[i]);
      expect(mutations.reduce((a, b) => a + b, 0)).toBe(0);
      // Plain text names: few, and no stroke or halo.
      const texts = container.querySelectorAll("svg > g:last-child text");
      expect(texts.length).toBeGreaterThan(0);
      expect(texts.length).toBeLessThanOrEqual(TOP_LABELS);
      const group = container.querySelector("svg > g:last-child");
      expect(group?.getAttribute("stroke")).toBeNull();
      expect(group?.getAttribute("paint-order")).toBeNull();
      observer.disconnect();
      act(() => root.unmount());
      container.remove();
    } finally {
      vi.useRealTimers();
    }
  });
});
