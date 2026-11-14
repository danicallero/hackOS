import type { TvConnectionNode } from "@hackos/shared/tv-connections";
import { describe, expect, it } from "vitest";
import { layoutGraph } from "./connections-layout";
import { buildConnectionsOption } from "./connections-option";

const palette = {
  person: "#00f",
  company: "#f90",
  edge: "#888",
  foreground: "#000",
  fontFamily: "x",
};

function build(count: number, focus: { hub: string; members: Set<string> } | null = null) {
  const nodes: TvConnectionNode[] = Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    kind: i % 50 === 0 ? "company" : "person",
    label: i % 2 ? null : `Name ${i}`,
    degree: 2,
  }));
  const edges = nodes
    .slice(1)
    .map((node, i) => ({ source: node.id, target: `n${(i * 3) % count}` }));
  const positions = layoutGraph(nodes, edges);
  const option = buildConnectionsOption({
    nodes,
    edges,
    positions,
    width: 1920,
    height: 1000,
    palette,
    labelled: new Set(["n0"]),
    focus,
    animate: false,
  });
  const series = (option.series as Array<Record<string, unknown>>)[0];
  return { series, nodes, edges };
}

describe("buildConnectionsOption", () => {
  it("renders 500+ nodes losslessly, silent, with fixed positions", () => {
    const { series, nodes, edges } = build(520);
    const data = series.data as Array<{ id: string; x: number; y: number }>;
    expect(data.filter((d) => !d.id.startsWith("anchor"))).toHaveLength(nodes.length);
    expect(series.links as unknown[]).toHaveLength(edges.length);
    expect(series.layout).toBe("none");
    expect(series.silent).toBe(true);
    expect(series.roam).toBe(false);
    expect(data.every((d) => Number.isFinite(d.x) && Number.isFinite(d.y))).toBe(true);
  });

  it("labels only the allow-listed named nodes and never anonymous ones", () => {
    const { series } = build(20);
    const data = series.data as Array<{ id: string; label: { show: boolean } }>;
    expect(data.filter((d) => d.label.show).map((d) => d.id)).toEqual(["n0"]);
  });

  it("dims everything outside the focused neighbourhood but keeps it drawn", () => {
    const { series } = build(20, { hub: "n1", members: new Set(["n1", "n2"]) });
    const data = series.data as Array<{ id: string; itemStyle: { opacity: number } }>;
    const byId = new Map(data.map((d) => [d.id, d.itemStyle.opacity]));
    expect(byId.get("n1")).toBe(1);
    expect(byId.get("n5")).toBeLessThan(0.3);
    expect(data.length).toBe(22);
  });
});
