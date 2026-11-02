import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  me: { id: 7, hasEventAccess: true, emailVerified: false },
}));

const getProfile = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: { get: getProfile } }));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/session", () => ({ useSessionContext: () => session }));
vi.mock("@/components/profile/public-profile-card", () => ({ PublicProfileCard: () => null }));
vi.mock("@/components/profile/profile-photo", () => ({ ProfilePhoto: () => null }));
vi.mock("@/components/common/language-select", () => ({ LanguageSelect: () => null }));
vi.mock("@/components/common/theme-toggle", () => ({ ThemeToggle: () => null }));

import { NetworkingOnboarding } from "@/components/profile/networking-onboarding";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  getProfile.mockReset();
  getProfile.mockReturnValue(new Promise(() => undefined));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("NetworkingOnboarding (H1, H7)", () => {
  it("waits for a verified email instead of showing the profile step", async () => {
    session.me.emailVerified = false;
    await act(async () => root.render(<NetworkingOnboarding>app</NetworkingOnboarding>));
    expect(container.textContent).toBe("app");
    expect(getProfile).not.toHaveBeenCalled();
  });

  it("starts the profile step once the email is verified", async () => {
    session.me.emailVerified = true;
    await act(async () => root.render(<NetworkingOnboarding>app</NetworkingOnboarding>));
    expect(container.textContent).not.toBe("app");
    expect(getProfile).toHaveBeenCalledWith("/api/me/public-profile");
  });
});
