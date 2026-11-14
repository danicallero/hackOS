import type { TvConnectionEdge, TvConnectionNode } from "@hackos/shared/tv-connections";
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

// jsdom has no layout: hand the graph a fixed portrait-ish box.
vi.mock("@/hooks/use-element-size", () => ({
  useElementSize: () => ({ ref: useRef(null), width: 1080, height: 1400 }),
}));

import { ConnectionsGraph } from "./connections-graph";

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
      root.render(
        <ConnectionsGraph
          nodes={nodes}
          edges={edges}
          label="graph"
          overviewLabel="Whole network"
          sectionLabel={(name, people) => `${name} ${people}`}
        />,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.querySelectorAll("path").length).toBeGreaterThan(500);
    expect(svg?.querySelectorAll("circle, rect").length).toBe(520);
    expect(container.querySelector("[data-testid=connections-caption]")?.textContent).toBe(
      "Whole network",
    );
    expect(performance.now() - started).toBeLessThan(5_000);
    act(() => root.unmount());
    container.remove();
  });
});
