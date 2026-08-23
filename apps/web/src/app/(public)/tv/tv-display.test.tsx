import { EVENTS } from "@hackos/shared/events";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { announcementContent } from "./announcement-content";
import { activeAnnouncement, TvDisplay } from "./tv-display";

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
  DEFAULT_ROTATION_SECONDS: 30,
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

describe("TV announcement layers", () => {
  const announcements = [
    {
      id: 1,
      title: "Integrated",
      body: "Below the content",
      publishAt: null,
      expiresAt: null,
      screenPlacement: "embedded" as const,
    },
    {
      id: 2,
      title: "Urgent",
      body: "All screens",
      publishAt: null,
      expiresAt: null,
      screenPlacement: "fullscreen" as const,
    },
  ];

  it("selects the first active notice of each placement in feed order", () => {
    expect(activeAnnouncement(announcements, "fullscreen")?.title).toBe("Urgent");
    expect(activeAnnouncement(announcements, "embedded")?.title).toBe("Integrated");
  });

  it("rotates between multiple notices sharing a placement by wall-clock time", () => {
    const rotationMs = 30_000;
    const shared = [
      {
        id: 10,
        title: "First",
        body: "",
        publishAt: null,
        expiresAt: null,
        screenPlacement: "fullscreen" as const,
      },
      {
        id: 11,
        title: "Second",
        body: "",
        publishAt: null,
        expiresAt: null,
        screenPlacement: "fullscreen" as const,
      },
      {
        id: 12,
        title: "Third",
        body: "",
        publishAt: null,
        expiresAt: null,
        screenPlacement: "fullscreen" as const,
      },
    ];
    const cycleMs = rotationMs * shared.length;
    const base = Math.floor(Date.now() / cycleMs) * cycleMs;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(base);
      expect(activeAnnouncement(shared, "fullscreen")?.title).toBe("First");
      vi.setSystemTime(base + rotationMs);
      expect(activeAnnouncement(shared, "fullscreen")?.title).toBe("Second");
      vi.setSystemTime(base + rotationMs * 2);
      expect(activeAnnouncement(shared, "fullscreen")?.title).toBe("Third");
      vi.setSystemTime(base + rotationMs * 3);
      expect(activeAnnouncement(shared, "fullscreen")?.title).toBe("First");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores legacy notices without an explicit screen placement", () => {
    expect(
      activeAnnouncement(
        [
          {
            id: 3,
            title: "Inbox only",
            body: "No wall display",
            publishAt: null,
            expiresAt: null,
          },
        ],
        "fullscreen",
      ),
    ).toBeUndefined();
  });

  it("uses the current language when available and falls back field-by-field to base copy", () => {
    const notice = {
      id: 4,
      title: "Cena lista",
      body: "Comedor principal",
      translations: { en: { title: "Dinner is ready", body: "" } },
      publishAt: null,
      expiresAt: null,
      screenPlacement: "embedded" as const,
    };
    expect(announcementContent(notice, "en")).toEqual({
      title: "Dinner is ready",
      body: "Comedor principal",
    });
    expect(announcementContent(notice, "gl")).toEqual({
      title: "Cena lista",
      body: "Comedor principal",
    });
  });
});
