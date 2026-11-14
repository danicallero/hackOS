import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { TvDisplay } from "./tv-display";

vi.mock("@/hooks/use-event-source", () => ({ useEventSource: () => ({ connected: true }) }));
vi.mock("./marquee-text", () => ({
  MarqueeText: ({ text }: { text: string }) => <span>{text}</span>,
}));
vi.mock("@/components/common/spinner", () => ({ Spinner: () => <span /> }));
const locale = vi.hoisted(() => ({ t: (key: string) => key, setLanguage: () => undefined }));
vi.mock("@/lib/i18n", () => ({ useLocale: () => locale }));
vi.mock("@/lib/api", () => ({
  api: {
    get: (path: string) =>
      Promise.resolve(
        path.includes("announcements")
          ? {
              items: [
                {
                  id: 1,
                  title: "Lunch",
                  body: "",
                  screenPlacement: "embedded",
                  translations: {},
                },
              ],
            }
          : path.includes("event")
            ? { name: "E" }
            : { items: [] },
      ),
  },
}));
vi.mock("@/lib/queue", () => ({ getAllRoomViews: () => Promise.resolve([]) }));
vi.mock("@/lib/logistics", () => ({
  logisticsApi: { publicSchedule: () => Promise.resolve({ items: [] }) },
}));
vi.mock("@/lib/tv", () => ({
  DEFAULT_ROTATION_SECONDS: 30,
  getTvState: () =>
    Promise.resolve({ mode: "connections", payload: null, broadcastAt: null, source: "manual" }),
  getTvVenueConfig: () => Promise.resolve({ wifi: null, language: "en" }),
}));
vi.mock("./connections-view", () => ({
  ConnectionsView: ({ announcement }: { announcement?: { title: string } }) => (
    <div data-testid="connections-view" data-announcement={announcement?.title} />
  ),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("TvDisplay connections dispatch", () => {
  it("renders the connections view when the selected mode is connections", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(<TvDisplay />));
    const view = container.querySelector("[data-testid=connections-view]");
    expect(view).not.toBeNull();
    expect(view?.getAttribute("data-announcement")).toBe("Lunch");
    act(() => root.unmount());
    container.remove();
  });
});
