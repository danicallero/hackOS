import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventConfig } from "@/lib/types";
import { EventConfigProvider } from "./event-config-context";
import { EventTab } from "./event-tab";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
const apiMock = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("@/lib/api", () => ({ ApiError: class ApiError extends Error {}, api: apiMock }));
const labels: Record<string, string> = {
  projectAudienceTeam: "Team only",
  projectAudienceAttendees: "Attendees",
  projectAudiencePublic: "Everyone",
  projectAudienceStaff: "Staff and sponsors",
};
const translate = (key: string) => labels[key] ?? key;
const localeValue = { t: translate };
vi.mock("@/lib/i18n", () => ({ useLocale: () => localeValue }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  apiMock.get.mockReset();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("project deadlines view", () => {
  it("falls back to a listed audience instead of a blank, dirty form when the stored value is unknown", async () => {
    apiMock.get.mockResolvedValue({
      timezone: "Europe/Madrid",
      projectDraftsOpenAt: "2026-09-23T00:00:00.000Z",
      projectSubmissionsCloseAt: "2026-10-18T00:00:00.000Z",
      projectDraftVisibility: "team_only",
      projectGalleryAudience: "participants",
      projectGalleryOpensAt: null,
      projectMaxTeamSize: null,
      projectGithubRequired: false,
    } as unknown as EventConfig);
    const onDirtyChange = vi.fn();
    await act(async () =>
      root.render(
        <EventConfigProvider refreshKey={0}>
          <EventTab view="participants" onDirtyChange={onDirtyChange} />
        </EventConfigProvider>,
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    const triggers = [...container.querySelectorAll('button[role="combobox"]')].map(
      (node) => node.textContent,
    );
    expect(triggers).toEqual(["Team only", "Staff and sponsors"]);
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);
  });
});
