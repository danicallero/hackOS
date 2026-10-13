import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: { get } }));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));

import { NetworkingProfileInvite } from "./networking-profile-invite";

let container: HTMLDivElement;
let root: Root;

async function mount() {
  await act(async () => {
    root.render(<NetworkingProfileInvite />);
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  get.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("NetworkingProfileInvite (H15)", () => {
  it("explains the profile and links to it while it was never created", async () => {
    get.mockResolvedValue({ consentedAt: null });
    await mount();
    expect(container.textContent).toContain("networkingInvite");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/settings/profile");
  });

  it("renders nothing once the profile exists", async () => {
    get.mockResolvedValue({ consentedAt: "2026-10-10T10:00:00.000Z" });
    await mount();
    expect(container.textContent).toBe("");
  });

  it("renders nothing when the profile cannot be read", async () => {
    get.mockRejectedValue(new Error("403"));
    await mount();
    expect(container.textContent).toBe("");
  });
});
