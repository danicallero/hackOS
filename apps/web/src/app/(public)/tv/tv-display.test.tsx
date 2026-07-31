import { EVENTS } from "@hackos/shared/events";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TvDisplay } from "./tv-display";

const { pending, useEventSource } = vi.hoisted(() => ({
  pending: new Promise<never>(() => undefined),
  useEventSource: vi.fn(() => ({ connected: true })),
}));

vi.mock("@/hooks/use-event-source", () => ({ useEventSource }));
vi.mock("@/components/common/spinner", () => ({ Spinner: () => <span /> }));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/api", () => ({ api: { get: () => pending } }));
vi.mock("@/lib/queue", () => ({ getAllRoomViews: () => pending }));
vi.mock("@/lib/logistics", () => ({ logisticsApi: { publicSchedule: () => pending } }));
vi.mock("@/hooks/use-fit-to-viewport", () => ({
  useFitToViewport: () => ({
    containerRef: { current: null },
    contentRef: { current: null },
    scale: 1,
    containerWidth: 0,
    contentWidthPercent: 100,
  }),
}));
vi.mock("@/lib/tv", () => ({
  getTvState: () => pending,
  getTvVenueConfig: () => pending,
  msUntilNextRotation: () => Number.POSITIVE_INFINITY,
  rotationIndexAt: () => 0,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("TvDisplay public realtime boundary", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    useEventSource.mockClear();
  });

  it("subscribes only to dedicated payload-free public invalidations", () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => root?.render(<TvDisplay />));

    expect(useEventSource).toHaveBeenCalledTimes(2);
    expect(useEventSource).toHaveBeenCalledWith(
      "/api/tv/stream",
      expect.objectContaining({ events: [EVENTS.DATA_CHANGED] }),
    );
    expect(useEventSource).toHaveBeenCalledWith(
      "/api/content/stream",
      expect.objectContaining({ events: [EVENTS.DATA_CHANGED] }),
    );
    expect(useEventSource).not.toHaveBeenCalledWith("/api/queue/stream", expect.anything());
  });
});
