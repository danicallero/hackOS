import type { TvConnectionsResponse } from "@hackos/shared/tv-connections";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicEvent } from "@/components/public/public-types";
import { ConnectionsView } from "./connections-view";

const { getTvConnections } = vi.hoisted(() => ({ getTvConnections: vi.fn() }));

vi.mock("@/lib/tv", () => ({ getTvConnections }));
vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));
vi.mock("./marquee-text", () => ({
  MarqueeText: ({ text }: { text: string }) => <span>{text}</span>,
}));
vi.mock("@/components/common/spinner", () => ({ Spinner: () => <span /> }));
vi.mock("@/hooks/use-tv-scale", () => ({
  useTvScale: () => ({ ref: { current: null }, scale: 1, portrait: false }),
}));
vi.mock("@/components/common/brand", () => ({ Brand: () => <span /> }));
vi.mock("./connections-graph", () => ({
  ConnectionsGraph: ({ nodes, edges }: { nodes: unknown[]; edges: unknown[] }) => (
    <div data-testid="graph" data-nodes={nodes.length} data-edges={edges.length} />
  ),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const event = { name: "HackUDC" } as PublicEvent;

function snapshot(overrides: Partial<TvConnectionsResponse> = {}): TvConnectionsResponse {
  return {
    nodes: [
      { id: "a", kind: "person", label: "Ana", degree: 1 },
      { id: "b", kind: "company", label: "Acme", degree: 1 },
    ],
    edges: [{ source: "a", target: "b" }],
    truncated: false,
    totals: { people: 1, companies: 1, connections: 1 },
    ...overrides,
  };
}

describe("ConnectionsView", () => {
  let root: Root;
  let container: HTMLDivElement;

  const render = async (invalidation = 0) => {
    await act(async () =>
      root.render(<ConnectionsView event={event} invalidation={invalidation} />),
    );
  };

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    getTvConnections.mockReset();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("shows a loading state until the first snapshot", async () => {
    getTvConnections.mockReturnValue(new Promise(() => undefined));
    await render();
    expect(container.querySelector("[aria-busy=true]")).not.toBeNull();
  });

  it("renders the graph without a stats row", async () => {
    getTvConnections.mockResolvedValue(snapshot());
    await render();
    expect(container.querySelector("[data-testid=graph]")?.getAttribute("data-nodes")).toBe("2");
    expect(container.querySelector("[data-testid=graph]")).not.toBeNull();
    expect(container.textContent).not.toContain("connectionsTruncated");
  });

  it("shows the friendly empty state", async () => {
    getTvConnections.mockResolvedValue(
      snapshot({ nodes: [], edges: [], totals: { people: 0, companies: 0, connections: 0 } }),
    );
    await render();
    expect(container.textContent).toContain("connectionsEmpty");
    expect(container.querySelector("[data-testid=graph]")).toBeNull();
  });

  it("notes truncated snapshots", async () => {
    getTvConnections.mockResolvedValue(snapshot({ truncated: true }));
    await render();
    expect(container.textContent).toContain("connectionsTruncated");
  });

  it("shows an error only when nothing was ever loaded", async () => {
    getTvConnections.mockRejectedValue(new Error("down"));
    await render();
    expect(container.textContent).toContain("connectionsUnavailable");
  });

  it("keeps the last data when a later poll fails", async () => {
    getTvConnections.mockResolvedValueOnce(snapshot());
    await render();
    getTvConnections.mockRejectedValue(new Error("down"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    expect(getTvConnections).toHaveBeenCalledTimes(2);
    expect(container.querySelector("[data-testid=graph]")).not.toBeNull();
    expect(container.textContent).toContain("tvReconnecting");
  });

  it("refetches after an invalidation, at most once per floor interval", async () => {
    getTvConnections.mockResolvedValue(snapshot());
    await render();
    await render(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    // The initial load was under the floor, so the invalidation is coalesced.
    expect(getTvConnections).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await render(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    expect(getTvConnections).toHaveBeenCalledTimes(2);
  });
});
