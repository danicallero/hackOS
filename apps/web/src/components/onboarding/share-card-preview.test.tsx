import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const state = vi.hoisted(() => ({
  render: { status: "loading" } as
    | { status: "loading" }
    | { status: "error" }
    | { status: "ready"; url: string },
  seen: [] as { name: string; format: string; photo?: string | null }[],
}));
vi.mock("@/lib/public-content", () => ({
  getPublicEvent: async () => ({
    name: "HackUDC",
    hackingStartsAt: "2027-02-27T09:00:00Z",
    hackingEndsAt: "2027-02-28T21:00:00Z",
    timezone: "Europe/Madrid",
  }),
}));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ language: "es", t: (k: string) => k }) }));
vi.mock("@/components/onboarding/social-sharing", () => ({
  SHARE_ART: { seagullPortrait: "/onboarding/emilia-portrait.png" },
  useShareImage: (
    _event: unknown,
    attendee: { displayName: string; photoUrl?: string | null },
    format: string,
  ) => {
    state.seen.push({ name: attendee.displayName, format, photo: attendee.photoUrl });
    return { render: state.render, retry: () => undefined };
  },
}));

import { ShareCardPreview } from "./share-card-preview";

describe("share card preview after confirming (H15)", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    state.seen = [];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("fans the landscape and story cards with the sample attendee once ready", async () => {
    state.render = { status: "ready", url: "blob:card" };
    await act(async () => root.render(<ShareCardPreview />));
    const images = [...container.querySelectorAll("img")].map((img) => img.getAttribute("src"));
    expect(images).toEqual(["blob:card", "blob:card"]);
    expect(state.seen.slice(-2)).toEqual([
      {
        name: "Emilia Gaivota",
        format: "landscape",
        photo: `${location.origin}/onboarding/emilia-portrait.png`,
      },
      {
        name: "Emilia Gaivota",
        format: "story",
        photo: `${location.origin}/onboarding/emilia-portrait.png`,
      },
    ]);
  });

  it("shows nothing while drawing or when drawing fails", async () => {
    state.render = { status: "error" };
    await act(async () => root.render(<ShareCardPreview />));
    expect(container.innerHTML).toBe("");
  });
});
