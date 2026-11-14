import type { TvConnectionEdge, TvConnectionNode } from "@hackos/shared/tv-connections";
import { describe, expect, it } from "vitest";
import { buildFocusGroups, labelledNodeIds, layoutGraph } from "./connections-layout";

function sampleGraph(people: number, companies = 6) {
  const nodes: TvConnectionNode[] = [];
  const edges: TvConnectionEdge[] = [];
  for (let c = 0; c < companies; c++)
    nodes.push({ id: `c${c}`, kind: "company", label: `Company ${c}`, degree: 0 });
  for (let p = 0; p < people; p++)
    nodes.push({ id: `p${p}`, kind: "person", label: p % 3 ? null : `Person ${p}`, degree: 0 });
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
    const nodes = [...base.nodes, { id: "new", kind: "person" as const, label: null, degree: 1 }];
    const edges = [...base.edges, { source: "new", target: "p5" }];
    const next = layoutGraph(nodes, edges, first);
    const anchor = next.get("p5");
    const added = next.get("new");
    expect(anchor && added && Math.hypot(anchor.x - added.x, anchor.y - added.y)).toBeLessThan(0.2);
  });

  it("ignores edges to unknown nodes and handles an empty graph", () => {
    expect(layoutGraph([], []).size).toBe(0);
    const nodes: TvConnectionNode[] = [{ id: "a", kind: "person", label: null, degree: 1 }];
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

describe("labelledNodeIds", () => {
  it("labels companies and well-connected named people only", () => {
    const nodes: TvConnectionNode[] = [
      { id: "co", kind: "company", label: "Acme", degree: 1 },
      { id: "hub", kind: "person", label: "Ana", degree: 9 },
      { id: "leaf", kind: "person", label: "Leo", degree: 1 },
      { id: "anon", kind: "person", label: null, degree: 20 },
    ];
    expect([...labelledNodeIds(nodes)].sort()).toEqual(["co", "hub"]);
  });

  it("caps labels so large graphs stay readable", () => {
    const { nodes } = sampleGraph(500, 40);
    for (const node of nodes) node.degree = 5;
    expect(labelledNodeIds(nodes).size).toBeLessThanOrEqual(26);
  });
});

describe("buildFocusGroups", () => {
  it("starts at the biggest hub and skips hubs already covered", () => {
    const nodes: TvConnectionNode[] = [
      { id: "h", kind: "company", label: "H", degree: 3 },
      { id: "a", kind: "person", label: null, degree: 1 },
      { id: "b", kind: "person", label: null, degree: 1 },
      { id: "c", kind: "person", label: null, degree: 2 },
      { id: "x", kind: "person", label: null, degree: 1 },
      { id: "y", kind: "person", label: null, degree: 1 },
    ];
    const edges = [
      { source: "h", target: "a" },
      { source: "h", target: "b" },
      { source: "h", target: "c" },
      { source: "c", target: "x" },
      { source: "x", target: "y" },
    ];
    const groups = buildFocusGroups(nodes, edges);
    expect(groups[0].hub).toBe("h");
    expect([...groups[0].members].sort()).toEqual(["a", "b", "c", "h"]);
    expect(groups.map((g) => g.hub)).not.toContain("a");
    expect(buildFocusGroups([], [])).toEqual([]);
  });

  it("limits the rotation length", () => {
    const { nodes, edges } = sampleGraph(500);
    expect(buildFocusGroups(nodes, edges, 8).length).toBeLessThanOrEqual(8);
  });
});
