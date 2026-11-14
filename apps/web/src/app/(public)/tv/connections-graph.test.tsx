import type { TvConnectionEdge, TvConnectionNode } from "@hackos/shared/tv-connections";
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

// jsdom has no layout: hand the graph a fixed portrait-ish box.
const box = vi.hoisted(() => ({ width: 1080, height: 1400 }));
vi.mock("@/hooks/use-element-size", () => ({
  useElementSize: () => ({ ref: useRef(null), ...box }),
}));

import {
  ConnectionsGraph,
  DATA_MS,
  LABEL_LEAD_MS,
  logoCandidates,
  MOVE_MS,
  nodeScale,
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

  it("keeps touring after a full cycle (the loop returns to the first section)", async () => {
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
      for (let c = 0; c < 3; c++)
        for (let i = 0; i < 8; i++) {
          nodes.push({ id: `p${c}-${i}`, kind: "person", label: `Person ${c}-${i}`, degree: 2 });
          edges.push({ source: `p${c}-${i}`, target: `p${c}-${(i + 1) % 8}` });
          edges.push({ source: `p${c}-${i}`, target: `p${c}-${(i + 3) % 8}` });
        }
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      await act(async () =>
        root.render(<ConnectionsGraph nodes={nodes} edges={edges} label="graph" />),
      );
      const labelCount = () => container.querySelectorAll("svg > g:last-child text").length;
      // Overview, three sections, overview, then the loop wraps onto another overview.
      const sectionMs = 10_000 + MOVE_MS;
      const overviewMs = OVERVIEW_DWELL_MS + MOVE_MS;
      const cycleMs = overviewMs * 3 + sectionMs * 3;
      for (let t = 0; t < cycleMs; t += 500)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(500);
        });
      // Into the first section again: labelled, where the stalled tour stayed on the overview.
      let seen = 0;
      for (let t = 0; t < sectionMs; t += 500) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(500);
        });
        seen = Math.max(seen, labelCount());
      }
      expect(seen).toBeGreaterThan(0);
      act(() => root.unmount());
      container.remove();
    } finally {
      vi.useRealTimers();
    }
  });

  it("draws edges once the box is measured after an unmeasured first render", async () => {
    const nodes: TvConnectionNode[] = Array.from({ length: 4 }, (_, i) => ({
      id: `n${i}`,
      kind: "person",
      label: `N${i}`,
      degree: 2,
    }));
    const edges: TvConnectionEdge[] = [
      { source: "n0", target: "n1" },
      { source: "n1", target: "n2" },
      { source: "n2", target: "n3" },
    ];
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    Object.assign(box, { width: 0, height: 0 });
    try {
      await act(async () =>
        root.render(<ConnectionsGraph nodes={nodes} edges={edges} label="graph" />),
      );
      Object.assign(box, { width: 800, height: 450 });
      await act(async () =>
        root.render(<ConnectionsGraph nodes={nodes} edges={edges} label="graph" />),
      );
      expect(container.querySelectorAll("svg line").length).toBe(edges.length);
    } finally {
      Object.assign(box, { width: 1080, height: 1400 });
      act(() => root.unmount());
      container.remove();
    }
  });

  it("animates a data update: kept nodes stay, new ones grow in, removed ones fade then drop", async () => {
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
      const person = (id: string, degree = 2): TvConnectionNode => ({
        id,
        kind: "person",
        label: id,
        degree,
      });
      const company: TvConnectionNode = { id: "co", kind: "company", label: "Co", degree: 4 };
      const ids = ["a", "b", "c", "d"];
      const first = {
        nodes: [company, ...ids.map((i) => person(i))],
        edges: ids.map((i) => ({ source: i, target: "co" })),
      };
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      const show = (s: { nodes: TvConnectionNode[]; edges: TvConnectionEdge[] }) =>
        act(async () =>
          root.render(<ConnectionsGraph nodes={s.nodes} edges={s.edges} label="g" />),
        );
      const el = (id: string) => container.querySelector<SVGElement>(`[data-nid="${id}"]`);
      await show(first);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      const kept = el("b");
      const keptCompany = el("co");
      expect(kept).not.toBeNull();

      // Identical content in fresh arrays: nothing is touched.
      await show({
        nodes: first.nodes.map((n) => ({ ...n })),
        edges: first.edges.map((e) => ({ ...e })),
      });
      expect(el("b")).toBe(kept);
      expect(container.querySelectorAll("[data-ghost]")).toHaveLength(0);

      // a leaves, e arrives.
      const second = {
        nodes: [company, ...["b", "c", "d", "e"].map((i) => person(i))],
        edges: ["b", "c", "d", "e"].map((i) => ({ source: i, target: "co" })),
      };
      await show(second);
      const added = el("e");
      expect(added).not.toBeNull();
      expect(Number(added?.style.opacity)).toBe(0);
      expect(el("a")?.dataset.ghost).toBe("");
      expect(container.querySelector('line[data-a="a"]')?.getAttribute("data-ghost")).toBe("");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(LABEL_LEAD_MS + DATA_MS / 2);
      });
      // Mid-transition: still mounted, partly faded.
      const mid = Number(el("a")?.style.opacity);
      expect(mid).toBeGreaterThan(0);
      expect(mid).toBeLessThan(0.92);
      expect(Number(added?.style.opacity)).toBeGreaterThan(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DATA_MS + 200);
      });
      expect(el("a")).toBeNull();
      expect(el("b")).toBe(kept);
      expect(el("co")).toBe(keptCompany);
      expect(el("e")).toBe(added);
      expect(Number(added?.style.opacity)).toBeGreaterThan(0.5);
      act(() => root.unmount());
      container.remove();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("id rotation", () => {
  it("crossfades a total id replacement in place: no node at the origin, none shrunk", async () => {
    const make = (p: string) => {
      const nodes: TvConnectionNode[] = [
        {
          id: `${p}c`,
          kind: "company",
          label: "acme",
          degree: 3,
          logoUrl: null,
          logoNegativeUrl: null,
        },
        ...["a", "b", "d", "e"].map((k) => ({
          id: p + k,
          kind: "person" as const,
          label: k,
          degree: 1,
        })),
      ];
      const edges = ["a", "b", "d", "e"].map((k) => ({ source: p + k, target: `${p}c` }));
      return { nodes, edges };
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const one = make("x");
    await act(async () =>
      root.render(<ConnectionsGraph nodes={one.nodes} edges={one.edges} label="graph" />),
    );
    const two = make("y");
    await act(async () =>
      root.render(<ConnectionsGraph nodes={two.nodes} edges={two.edges} label="graph" />),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    for (const el of container.querySelectorAll("[data-nid]:not([data-ghost])")) {
      const m = /translate\(([-\d.e]+) ([-\d.e]+)\) scale\(([-\d.e]+)\)/.exec(
        el.getAttribute("transform") ?? "",
      );
      expect(m).not.toBeNull();
      expect(Math.abs(Number(m?.[1])) + Math.abs(Number(m?.[2]))).toBeGreaterThan(1);
      if (String((el as HTMLElement).dataset.nid).startsWith("y"))
        expect(Number(m?.[3])).toBeGreaterThan(0.5);
    }
    act(() => root.unmount());
    container.remove();
  });
});

describe("nodeScale", () => {
  it("shrinks dimmed nodes to a small constant screen size", () => {
    const st = { x: 0, y: 0, o: 1, s: 1, d: 1 };
    expect(nodeScale(st, false, 4) * 4).toBeCloseTo(1);
    expect(nodeScale({ ...st, d: 0 }, false, 4)).toBeCloseTo(4 ** -0.3);
    expect(nodeScale(st, true, 4) * 4).toBeLessThan(0.5);
    expect(nodeScale({ ...st, d: 0 }, true, 4)).toBeCloseTo(0.5);
  });
});
