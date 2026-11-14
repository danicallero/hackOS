import type { TvConnectionEdge, TvConnectionNode } from "@hackos/shared/tv-connections";
import { describe, expect, it } from "vitest";
import {
  apparentRadius,
  buildSequence,
  cameraFor,
  communityAnchors,
  createCoalescer,
  detectSections,
  diffSnapshots,
  layoutGraph,
  linkAlpha,
  nodeRadius,
  personRadius,
  selectLabels,
  snapshotSignature,
  spawnPoint,
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

describe("layoutGraph spacing", () => {
  it("keeps companies apart from each other and from people, deterministically", () => {
    const { nodes, edges } = sampleGraph(60, 6);
    const a = layoutGraph(nodes, edges);
    const b = layoutGraph(nodes, edges);
    expect([...b]).toEqual([...a]);
    const dist = (x: string, y: string) => {
      const p = a.get(x);
      const q = a.get(y);
      return Math.hypot((p?.x ?? 0) - (q?.x ?? 0), (p?.y ?? 0) - (q?.y ?? 0));
    };
    const companies = nodes.filter((n) => n.kind === "company").map((n) => n.id);
    const people = nodes.filter((n) => n.kind === "person").map((n) => n.id);
    let closestCompanies = Number.POSITIVE_INFINITY;
    for (const x of companies)
      for (const y of companies)
        if (x < y) closestCompanies = Math.min(closestCompanies, dist(x, y));
    let closestPerson = Number.POSITIVE_INFINITY;
    for (const x of companies)
      for (const y of people) closestPerson = Math.min(closestPerson, dist(x, y));
    // Unit-square distances: logos (r≈0.045) must not touch each other or a dot.
    expect(closestCompanies).toBeGreaterThan(0.09);
    expect(closestPerson).toBeGreaterThan(0.02);
  });
});

describe("layoutGraph", () => {
  it("is deterministic and stays bounded (the view rescales to the settled bounds)", () => {
    const { nodes, edges } = sampleGraph(60);
    const a = layoutGraph(nodes, edges);
    const b = layoutGraph([...nodes].reverse(), edges);
    expect(a.size).toBe(nodes.length);
    for (const [id, point] of a) {
      expect(point.x).toBeGreaterThanOrEqual(-0.6);
      expect(point.x).toBeLessThanOrEqual(1.6);
      expect(point.y).toBeGreaterThanOrEqual(-0.6);
      expect(point.y).toBeLessThanOrEqual(1.6);
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
    expect(anchor && added && Math.hypot(anchor.x - added.x, anchor.y - added.y)).toBeLessThan(0.3);
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

  it("frames by the people and ignores a distant company", () => {
    const world = new Map([
      ["a", { x: 400, y: 400 }],
      ["b", { x: 500, y: 450 }],
      ["far", { x: 1900, y: 1500 }],
      ["near", { x: 520, y: 430 }],
    ]);
    const solo = cameraFor({ people: ["a", "b"], companies: [] }, world, 1000, 800);
    expect(cameraFor({ people: ["a", "b"], companies: ["far"] }, world, 1000, 800)).toEqual(solo);
    const withNear = cameraFor({ people: ["a", "b"], companies: ["near"] }, world, 1000, 800);
    expect(withNear.cx).toBeGreaterThan(solo.cx);
  });

  it("keeps a near logo inside the frame", () => {
    const world = new Map([
      ["a", { x: 400, y: 400 }],
      ["b", { x: 500, y: 450 }],
      ["near", { x: 530, y: 440 }],
    ]);
    const cam = cameraFor({ people: ["a", "b"], companies: ["near"] }, world, 1000, 800);
    const sx = (530 - cam.cx) * cam.zoom + 500;
    expect(sx).toBeGreaterThan(0);
    expect(sx).toBeLessThan(1000);
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

  it("personRadius separates the 4-10 band and keeps outliers distinct but capped", () => {
    const degrees = [1, 2, 3, 4, 6, 8, 10, 15, 20, 30, 50, 80, 120, 1000];
    for (let i = 1; i < degrees.length; i++) {
      expect(personRadius(degrees[i])).toBeGreaterThan(personRadius(degrees[i - 1]));
    }
    expect(personRadius(10) / personRadius(4)).toBeGreaterThanOrEqual(1.35);
    const outlier = personRadius(50) / personRadius(4);
    expect(outlier).toBeGreaterThan(3);
    expect(outlier).toBeLessThan(5.5);
    expect(personRadius(80)).toBeGreaterThan(personRadius(50) * 1.1);
    expect(personRadius(120)).toBeGreaterThan(personRadius(50));
    expect(personRadius(1)).toBeGreaterThanOrEqual(2.5);
    expect(personRadius(1e6)).toBeLessThan(36);
  });

  it("grows company logos slower than the camera zoom", () => {
    expect(apparentRadius(4, "company", 1, 4) / apparentRadius(4, "company", 1, 1)).toBeCloseTo(2);
    expect(apparentRadius(4, "person", 1, 4) / apparentRadius(4, "person", 1, 1)).toBeCloseTo(4);
  });
});

describe("snapshot updates", () => {
  const person = (id: string, degree = 1) => ({ id, kind: "person" as const, label: id, degree });
  const prev = {
    nodes: [person("a"), person("b"), person("c")],
    edges: [
      { source: "a", target: "b" },
      { source: "b", target: "c" },
    ],
  };
  const next = {
    nodes: [person("b"), person("c"), person("d")],
    edges: [
      { source: "b", target: "c" },
      { source: "c", target: "d" },
    ],
  };

  it("diffs added, removed and kept nodes and edges", () => {
    const d = diffSnapshots(prev, next);
    expect(d.addedNodes).toEqual(["d"]);
    expect(d.removedNodes).toEqual(["a"]);
    expect(d.keptNodes).toEqual(["b", "c"]);
    expect(d.addedEdges).toEqual(["c|d"]);
    expect(d.removedEdges).toEqual(["a|b"]);
    expect(d.keptEdges).toEqual(["b|c"]);
    expect(diffSnapshots(null, next).addedNodes).toHaveLength(3);
  });

  it("signature ignores order, notices content", () => {
    const shuffled = { nodes: [...prev.nodes].reverse(), edges: [...prev.edges].reverse() };
    expect(snapshotSignature(shuffled.nodes, shuffled.edges)).toBe(
      snapshotSignature(prev.nodes, prev.edges),
    );
    expect(snapshotSignature(next.nodes, next.edges)).not.toBe(
      snapshotSignature(prev.nodes, prev.edges),
    );
    expect(snapshotSignature([person("a", 2)], [])).not.toBe(snapshotSignature([person("a")], []));
  });

  it("coalesces updates that land mid-transition into the newest one", () => {
    const q = createCoalescer<string>();
    expect(q.offer("one", false)).toBe("one");
    expect(q.offer("two", true)).toBeNull();
    expect(q.offer("three", true)).toBeNull();
    expect(q.release()).toBe("three");
    expect(q.release()).toBeNull();
    q.offer("four", true);
    expect(q.offer("five", false)).toBe("five");
    expect(q.release()).toBeNull();
  });
});

/** Six planted communities of 25, a hub each linking across, a logo per community. */
function plantedGraph() {
  const nodes: TvConnectionNode[] = [];
  const edges: TvConnectionEdge[] = [];
  const add = (a: string, b: string) => edges.push({ source: a, target: b });
  for (let c = 0; c < 6; c++) {
    nodes.push({ id: `co${c}`, kind: "company", label: `Co ${c}`, degree: 0 });
    for (let i = 0; i < 25; i++) {
      nodes.push({ id: `g${c}-${i}`, kind: "person", label: `P ${c}-${i}`, degree: 0 });
      for (const step of [1, 2, 5]) add(`g${c}-${i}`, `g${c}-${(i + step) % 25}`);
      if (i % 3 === 0) add(`g${c}-${i}`, `co${c}`);
    }
    for (let k = 0; k < 8; k++) add(`g${c}-0`, `g${(c + 1 + (k % 5)) % 6}-${k * 3}`);
  }
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  for (const n of nodes) n.degree = degree.get(n.id) ?? 0;
  return { nodes, edges };
}

describe("community layout", () => {
  it("puts community anchors on a deterministic ellipse around the centre", () => {
    expect(communityAnchors(0)).toEqual([]);
    expect(communityAnchors(1)).toEqual([{ x: 0.5, y: 0.5 }]);
    const ring = communityAnchors(6);
    expect(communityAnchors(6)).toEqual(ring);
    expect(ring).toHaveLength(6);
    // Same normalised radius from the centre, evenly spaced, first (biggest) at the top.
    const norm = ring.map((p) => Math.hypot((p.x - 0.5) / 0.4, (p.y - 0.5) / 0.3));
    for (const r of norm) expect(r).toBeCloseTo(1, 6);
    expect(ring[0].y).toBeLessThan(0.5);
    expect(ring[0].x).toBeCloseTo(0.5, 6);
  });

  it("separates communities: centroids farther apart than the groups are wide", () => {
    const { nodes, edges } = plantedGraph();
    const pos = layoutGraph(nodes, edges);
    const centroids: Array<{ x: number; y: number }> = [];
    let spread = 0;
    for (let c = 0; c < 6; c++) {
      const pts = Array.from({ length: 25 }, (_, i) => pos.get(`g${c}-${i}`)).filter(
        (p): p is { x: number; y: number } => Boolean(p),
      );
      const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
      const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      centroids.push({ x: cx, y: cy });
      spread += pts.reduce((a, p) => a + Math.hypot(p.x - cx, p.y - cy), 0) / pts.length;
    }
    spread /= 6;
    let between = 0;
    let pairs = 0;
    for (let a = 0; a < 6; a++)
      for (let b = a + 1; b < 6; b++) {
        between += Math.hypot(centroids[a].x - centroids[b].x, centroids[a].y - centroids[b].y);
        pairs++;
      }
    expect(between / pairs).toBeGreaterThan(spread * 2);
  });

  it("never lets a logo sit under another node", () => {
    const { nodes, edges } = plantedGraph();
    const pos = layoutGraph(nodes, edges);
    for (const company of nodes.filter((n) => n.kind === "company")) {
      const c = pos.get(company.id);
      for (const other of nodes) {
        if (other.id === company.id) continue;
        const o = pos.get(other.id);
        if (!c || !o) continue;
        const need =
          (nodeRadius(company.degree, "company", 1) + nodeRadius(other.degree, other.kind, 1)) /
          1000;
        expect(Math.hypot(c.x - o.x, c.y - o.y)).toBeGreaterThanOrEqual(need);
      }
    }
  });

  it("keeps known nodes in place when a node is added to a community layout", () => {
    const { nodes, edges } = plantedGraph();
    const first = layoutGraph(nodes, edges);
    const grown = layoutGraph(
      [...nodes, { id: "late", kind: "person", label: "L", degree: 1 }],
      [...edges, { source: "late", target: "g2-3" }],
      first,
    );
    let moved = 0;
    for (const [id, p] of first) {
      const q = grown.get(id);
      if (q) moved = Math.max(moved, Math.hypot(p.x - q.x, p.y - q.y));
    }
    expect(moved).toBeLessThan(0.15);
  });

  it("fades hub links, strengthens focus and keeps the overview faint", () => {
    expect(linkAlpha(60, "overview")).toBeLessThan(linkAlpha(1, "overview"));
    expect(linkAlpha(1, "overview")).toBeLessThanOrEqual(0.2);
    expect(linkAlpha(5, "focus")).toBeGreaterThan(linkAlpha(5, "overview") * 3);
    expect(linkAlpha(5, "dim")).toBeLessThan(linkAlpha(5, "overview"));
    expect(linkAlpha(5, "dim")).toBeLessThan(linkAlpha(5, "focus") / 10);
  });
});

describe("spawnPoint", () => {
  it("starts on the neighbours' centroid, else on its own laid-out spot, never the origin", () => {
    expect(spawnPoint({ x: 300, y: 200 }, [])).toEqual({ x: 300, y: 200 });
    expect(
      spawnPoint({ x: 300, y: 200 }, [
        { x: 100, y: 100 },
        { x: 300, y: 300 },
      ]),
    ).toEqual({
      x: 200,
      y: 200,
    });
    expect(spawnPoint({ x: 300, y: 200 }, [{ x: Number.NaN, y: 1 }])).toEqual({ x: 300, y: 200 });
  });
});
