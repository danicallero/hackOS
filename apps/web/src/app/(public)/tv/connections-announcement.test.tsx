import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-event-source", () => ({ useEventSource: () => ({ connected: true }) }));
vi.mock("@/hooks/use-tv-scale", () => ({
  useTvScale: () => ({ ref: { current: null }, scale: 1, portrait: false }),
}));
vi.mock("./marquee-text", () => ({
  MarqueeText: ({ text }: { text: string }) => <span>{text}</span>,
}));
vi.mock("./connections-graph", () => ({ ConnectionsGraph: () => <div data-testid="graph" /> }));
const locale = vi.hoisted(() => ({ t: (key: string) => key, language: "en" }));
vi.mock("@/lib/i18n", () => ({ useLocale: () => locale }));
vi.mock("@/lib/tv", () => ({
  getTvConnections: () =>
    Promise.resolve({
      nodes: [{ id: "a", kind: "person", label: "A", degree: 1 }],
      edges: [],
      totals: { people: 1, companies: 0, connections: 0 },
      truncated: false,
    }),
}));

import { ConnectionsView } from "./connections-view";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const announcement = {
  id: 1,
  title: "Lunch is served",
  body: "Ground floor",
  screenPlacement: "embedded",
  translations: {},
} as never;

describe("ConnectionsView announcement popup", () => {
  it("floats the embedded announcement over the graph, bottom right", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(<ConnectionsView event={{ name: "E" } as never} announcement={announcement} />),
    );
    const popup = container.querySelector("[data-testid=connections-announcement]");
    expect(popup?.textContent).toContain("Lunch is served");
    expect(popup?.className).toContain("absolute");
    expect(popup?.className).toContain("bottom-");
    expect(popup?.className).toContain("right-");
    expect(container.querySelector("[data-testid=graph]")).not.toBeNull();
    act(() => root.unmount());
    container.remove();
  });

  it("renders no popup without an announcement", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<ConnectionsView event={{ name: "E" } as never} />));
    expect(container.querySelector("[data-testid=connections-announcement]")).toBeNull();
    act(() => root.unmount());
    container.remove();
  });
});
