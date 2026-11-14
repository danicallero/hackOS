import type { TvConnectionEdge, TvConnectionNode } from "@hackos/shared/tv-connections";
import { describe, expect, it } from "vitest";
import {
  apparentRadius,
  buildSequence,
  cameraFor,
  detectSections,
  layoutGraph,
  nodeRadius,
  selectLabels,
} from "./connections-layout";

function sampleGraph(people: number, companies = 6) {
  const nodes: TvConnectionNode[] = [];
  const edges: TvConnectionEdge[] = [];
  for (let c = 0; c < companies; c++)
    nodes.push({ id: `c${c}`, kind: "company", label: `Company ${c}`, degree: 0 });
  for (let p = 0; p < people; p++)
    nodes.push({ id: `p${p}`, kind: "person", label: p % 3 ? "" : `Person ${p}`, degree: 0 });
  const add = (source: string, target: string) => {
    edges.push({ source, target });
    for (const node of nodes) if (node.id === source || node.id === target) node.degree++;
  };
  for (let p = 0; p < people; p++) {
    add(`p${p}`, `p${(p * 7 + 1) % people}`);
    add(`p${p}`, `c${p % companies}`);
  }
  return { nodes, edges };
}

describe("layoutGraph", () => {
  it("is deterministic and keeps every node inside the unit square", () => {
    const { nodes, edges } = sampleGraph(60);
    const a = layoutGraph(nodes, edges);
    const b = layoutGraph([...nodes].reverse(), edges);
    expect(a.size).toBe(nodes.length);
    for (const [id, point] of a) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1);
      expect(b.get(id)).toEqual(point);
    }
  });

  it("barely moves known nodes when the snapshot refreshes", () => {
    const { nodes, edges } = sampleGraph(120);
    const first = layoutGraph(nodes, edges);
    const same = layoutGraph(nodes, edges, first);
    const grown = sampleGraph(125);
    const next = layoutGraph(grown.nodes, grown.edges, first);
    const drift = (positions: typeof first) => {
      let worst = 0;
      for (const [id, point] of first) {
        const moved = positions.get(id);
        if (moved) worst = Math.max(worst, Math.hypot(moved.x - point.x, moved.y - point.y));
      }
      return worst;
    };
    expect(drift(same)).toBeLessThan(0.08);
    expect(drift(next)).toBeLessThan(0.15);
  });

  it("places a new node next to the neighbour it connects to", () => {
    const base = sampleGraph(40);
    const first = layoutGraph(base.nodes, base.edges);
    const nodes = [...base.nodes, { id: "new", kind: "person" as const, label: "N", degree: 1 }];
    const edges = [...base.edges, { source: "new", target: "p5" }];
    const next = layoutGraph(nodes, edges, first);
    const anchor = next.get("p5");
    const added = next.get("new");
    expect(anchor && added && Math.hypot(anchor.x - added.x, anchor.y - added.y)).toBeLessThan(0.2);
  });

  it("ignores edges to unknown nodes and handles an empty graph", () => {
    expect(layoutGraph([], []).size).toBe(0);
    const nodes: TvConnectionNode[] = [{ id: "a", kind: "person", label: "A", degree: 1 }];
    expect(layoutGraph(nodes, [{ source: "a", target: "ghost" }]).size).toBe(1);
  });

  it("settles a dense 600-node graph within a bounded time", () => {
    const { nodes, edges } = sampleGraph(594);
    const started = performance.now();
    const positions = layoutGraph(nodes, edges);
    expect(positions.size).toBe(600);
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});

/** Three tight cliques of people, each with its own company, joined by one bridge. */
function cliques(size = 6) {
  const nodes: TvConnectionNode[] = [];
  const edges: TvConnectionEdge[] = [];
  for (let c = 0; c < 3; c++) {
    nodes.push({ id: `co${c}`, kind: "company", label: `Co ${c}`, degree: size });
    for (let i = 0; i < size; i++) {
      nodes.push({ id: `c${c}p${i}`, kind: "person", label: `P ${c}-${i}`, degree: size });
      edges.push({ source: `c${c}p${i}`, target: `co${c}` });
      for (let j = i + 1; j < size; j++) edges.push({ source: `c${c}p${i}`, target: `c${c}p${j}` });
    }
  }
  edges.push({ source: "c0p0", target: "c1p0" });
  return { nodes, edges };
}

describe("detectSections", () => {
  it("finds the cliques deterministically, ordered by size, with company anchors", () => {
    const { nodes, edges } = cliques();
    const a = detectSections(nodes, edges);
    const b = detectSections([...nodes].reverse(), [...edges].reverse());
    expect(a).toHaveLength(3);
    for (const section of a) {
      expect(section.people).toHaveLength(6);
      expect(new Set(section.people.map((id) => id.slice(0, 2))).size).toBe(1);
      expect(section.companies).toHaveLength(1);
    }
    expect(b.map((s) => [...s.people].sort())).toEqual(a.map((s) => [...s.people].sort()));
  });

  it("returns no sections for a tiny graph and copes with null labels", () => {
    expect(detectSections([], [])).toEqual([]);
    const nodes: TvConnectionNode[] = [
      { id: "a", kind: "person", label: null as unknown as string, degree: 1 },
      { id: "b", kind: "person", label: "B", degree: 1 },
    ];
    expect(detectSections(nodes, [{ source: "a", target: "b" }])).toEqual([]);
  });

  it("gives one section for one community and handles a 520-node graph", () => {
    const one = cliques(7);
    const single = detectSections(
      one.nodes.filter((n) => n.id.startsWith("c0") || n.id === "co0"),
      one.edges.filter((e) => e.source.startsWith("c0") && e.target.startsWith("c0")),
    );
    expect(single).toHaveLength(1);
    const { nodes, edges } = sampleGraph(514);
    const started = performance.now();
    const sections = detectSections(nodes, edges);
    expect(sections.length).toBeLessThanOrEqual(12);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe("buildSequence", () => {
  it("opens and closes on the overview and revisits it periodically", () => {
    expect(buildSequence(0)).toEqual([-1]);
    expect(buildSequence(2)).toEqual([-1, 0, 1, -1]);
    expect(buildSequence(7)).toEqual([-1, 0, 1, 2, -1, 3, 4, 5, -1, 6, -1]);
  });
});

describe("cameraFor", () => {
  it("frames the overview and zooms onto a section within bounds", () => {
    const world = new Map([
      ["a", { x: 100, y: 100 }],
      ["b", { x: 200, y: 150 }],
    ]);
    expect(cameraFor(null, world, 1000, 800)).toEqual({ zoom: 1, cx: 500, cy: 400 });
    const cam = cameraFor({ people: ["a", "b"], companies: [] }, world, 1000, 800);
    expect(cam.zoom).toBeGreaterThan(1.29);
    expect(cam.zoom).toBeLessThanOrEqual(5);
    expect(cam.cx).toBeCloseTo(150, 0);
    expect(cameraFor({ people: ["x"], companies: [] }, world, 1000, 800).zoom).toBe(1);
  });
});

describe("selectLabels", () => {
  it("never overlaps, respects the cap and priority, and stays in frame", () => {
    const candidates = Array.from({ length: 80 }, (_, i) => ({
      id: `n${i}`,
      text: `Person number ${i}`,
      x: 100 + (i % 10) * 20,
      y: 100 + Math.floor(i / 10) * 12,
      r: 6,
      priority: i,
    }));
    const placed = selectLabels(candidates, 1000, 800, 20, 12);
    expect(placed.length).toBeGreaterThan(0);
    expect(placed.length).toBeLessThanOrEqual(12);
    expect(placed[0].id).toBe("n79");
    const box = (l: (typeof placed)[number]) => {
      const w = l.text.length * 20 * 0.58;
      const left = l.anchor === "start" ? l.x : l.anchor === "end" ? l.x - w : l.x - w / 2;
      return [left, l.y - 10, left + w, l.y + 10];
    };
    for (const a of placed)
      for (const b of placed) {
        if (a === b) continue;
        const [x0, y0, x1, y1] = box(a);
        const [u0, v0, u1, v1] = box(b);
        expect(x0 < u1 && x1 > u0 && y0 < v1 && y1 > v0).toBe(false);
      }
    expect(selectLabels([{ ...candidates[0], x: -5 }], 1000, 800, 20, 5)).toEqual([]);
    expect(selectLabels([{ ...candidates[0], text: " " }], 1000, 800, 20, 5)).toEqual([]);
  });
});

describe("label placement next to the dot", () => {
  const base = { id: "a", text: "Ana", x: 500, y: 400, r: 10, priority: 1 };

  it("sits adjacent to its node, offset by the on-screen radius", () => {
    const [label] = selectLabels([base], 1000, 800, 20, 5);
    expect(label.anchor).toBe("start");
    expect(label.y).toBe(400);
    expect(label.x - base.x).toBeGreaterThanOrEqual(base.r);
    expect(label.x - base.x).toBeLessThan(base.r + 20);
  });

  it("moves away from a company square instead of covering it", () => {
    const company = { id: "co", x: 540, y: 400, r: 30 };
    const [label] = selectLabels([base], 1000, 800, 20, 5, [company]);
    const w = base.text.length * 20 * 0.58;
    const left =
      label.anchor === "start" ? label.x : label.anchor === "end" ? label.x - w : label.x - w / 2;
    const overlaps =
      left < company.x + company.r &&
      left + w > company.x - company.r &&
      label.y - 14 < company.y + company.r &&
      label.y + 14 > company.y - company.r;
    expect(overlaps).toBe(false);
    expect(Math.hypot(label.x - base.x, label.y - base.y)).toBeLessThan(120);
  });

  it("skips a label rather than covering a node when nothing fits", () => {
    const ring = [
      { id: "r", x: 520, y: 400, r: 40 },
      { id: "l", x: 480, y: 400, r: 40 },
      { id: "u", x: 500, y: 370, r: 40 },
      { id: "d", x: 500, y: 430, r: 40 },
    ];
    expect(selectLabels([base], 1000, 800, 20, 5, ring)).toEqual([]);
  });

  it("sizes people strongly by degree and keeps every company bigger", () => {
    const leaf = nodeRadius(1, "person", 1);
    const hub = nodeRadius(30, "person", 1);
    expect(hub / leaf).toBeGreaterThan(3);
    expect(leaf).toBeLessThan(6);
    expect(nodeRadius(10_000, "person", 1)).toBeLessThan(nodeRadius(0, "company", 1));
    expect(nodeRadius(1, "person", 2)).toBeCloseTo(leaf * 2);
  });

  it("grows company logos slower than the camera zoom", () => {
    expect(apparentRadius(4, "company", 1, 4) / apparentRadius(4, "company", 1, 1)).toBeCloseTo(2);
    expect(apparentRadius(4, "person", 1, 4) / apparentRadius(4, "person", 1, 1)).toBeCloseTo(4);
  });
});
