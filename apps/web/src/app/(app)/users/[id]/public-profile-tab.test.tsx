import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicProfile } from "@/components/profile/public-profile-form";
import type { UserDetail } from "@/lib/types";

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const state = vi.hoisted(() => ({ canEdit: true, profile: null as PublicProfile | null }));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/session", () => ({ useCan: () => state.canEdit }));
vi.mock("@/lib/use-unsaved-changes-guard", () => ({ useUnsavedChangesGuard: vi.fn() }));
vi.mock("@/hooks/use-event-source", () => ({
  useLiveQuery: () => ({
    data: { generation: 0, profile: state.profile },
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/lib/api", () => ({
  ApiError: class extends Error {},
  api: { put: vi.fn(), delete: vi.fn(), get: vi.fn() },
}));
vi.mock("@/components/profile/cv-viewer", () => ({
  CvViewer: ({ trigger }: { trigger: React.ReactNode }) => trigger,
}));

import { api } from "@/lib/api";
import { PublicProfileTab } from "./public-profile-tab";

const user = { id: 7, image: "/api/users/7/photo" } as UserDetail;
function profile(): PublicProfile {
  return {
    directoryVisible: false,
    showSurname: false,
    showPhoto: false,
    showProject: true,
    headline: "Stored headline",
    bio: "Stored bio",
    locationNote: null,
    socials: [],
    shareCv: false,
    cv: { filename: "cv.pdf", uploadedAt: "2026-10-10T10:00:00Z", source: "upload" },
    consentedAt: null,
    preview: {
      userId: 7,
      displayName: "Ana P.",
      headline: "Stored headline",
      photoUrl: null,
      bio: "Stored bio",
      locationNote: null,
      socials: [],
      cvUrl: null,
      projects: [],
      challenges: [],
    },
  };
}

describe("staff public profile moderation (#935)", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.clearAllMocks();
    state.canEdit = true;
    state.profile = profile();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  async function render() {
    await act(async () => root.render(<PublicProfileTab user={user} onUpdated={vi.fn()} />));
  }
  function button(label: string, scope: ParentNode = document): HTMLButtonElement {
    const found = Array.from(scope.querySelectorAll("button")).find(
      (node) => node.textContent === label,
    );
    expect(found).toBeDefined();
    return found as HTMLButtonElement;
  }

  it("shows a hidden profile and its CV without granting editing to readers", async () => {
    state.canEdit = false;
    await render();
    expect(container.textContent).toContain("publicProfileNotShared");
    expect(container.textContent).toContain("Stored bio");
    expect(container.textContent).toContain("viewCv");
    expect(container.querySelector("input, textarea")).toBeNull();
    expect(container.textContent).not.toContain("removeCv");
  });

  it("edits stored fields while hidden and keeps sharing off", async () => {
    vi.mocked(api.put).mockResolvedValue({ ...profile(), headline: "Moderated" });
    await render();
    const input = container.querySelector('input:not([type="checkbox"])') as HTMLInputElement;
    await act(async () => {
      await userEvent.clear(input);
      await userEvent.type(input, "Moderated");
    });
    await act(async () => {
      await userEvent.click(button("saveChanges", container));
    });
    expect(api.put).toHaveBeenCalledWith(
      "/api/users/7/public-profile",
      expect.objectContaining({ directoryVisible: false, headline: "Moderated" }),
    );
  });

  it("requires confirmation before deleting a CV and retains unsaved edits", async () => {
    vi.mocked(api.delete).mockResolvedValue({ ...profile(), cv: null, shareCv: false });
    await render();
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      await userEvent.clear(textarea);
      await userEvent.type(textarea, "Pending bio");
      await userEvent.click(button("removeCv", container));
    });
    expect(api.delete).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
    expect(dialog.textContent).toContain("publicProfileRemoveCvDesc");
    await act(async () => {
      await userEvent.click(button("removeCv", dialog));
    });
    expect(api.delete).toHaveBeenCalledWith("/api/users/7/public-profile/cv");
    expect(textarea.value).toBe("Pending bio");
  });

  it("stops sharing without erasing stored text", async () => {
    state.profile = { ...profile(), directoryVisible: true };
    vi.mocked(api.put).mockResolvedValue(profile());
    await render();
    await act(async () => {
      await userEvent.click(button("publicProfileStopSharing", container));
    });
    expect(api.put).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role="alertdialog"]') as HTMLElement;
    await act(async () => {
      await userEvent.click(button("publicProfileStopSharing", dialog));
    });
    expect(api.put).toHaveBeenCalledWith(
      "/api/users/7/public-profile",
      expect.objectContaining({
        directoryVisible: false,
        headline: "Stored headline",
        bio: "Stored bio",
      }),
    );
  });
});
