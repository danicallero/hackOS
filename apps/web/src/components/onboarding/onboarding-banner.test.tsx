import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  path: "/event",
  me: { id: 7, hasEventAccess: true, emailVerified: true } as Record<string, unknown>,
  data: null as unknown,
}));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.path }));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/session", () => ({ useSessionContext: () => ({ me: mocks.me }) }));
vi.mock("@/hooks/use-server-resource", () => ({
  useServerResource: () => ({ data: mocks.data }),
}));

import { OnboardingBanner } from "@/components/onboarding/onboarding-banner";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const journey = (...statuses: string[]) => ({
  eventKey: "k",
  revision: 1,
  steps: statuses.map((status, index) => ({
    step: ["profile", "networking", "share"][index],
    status,
  })),
});
let container: HTMLDivElement;
let root: Root;
const render = () => act(async () => root.render(<OnboardingBanner />));

beforeEach(() => {
  mocks.path = "/event";
  mocks.me = { id: 7, hasEventAccess: true, emailVerified: true };
  mocks.data = journey("pending");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("OnboardingBanner", () => {
  it("prompts while a step is pending or put off, and links back with the current page", async () => {
    await render();
    expect(container.textContent).toContain("onboardingBanner");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/onboarding?next=%2Fevent");
    mocks.data = journey("completed", "deferred");
    await render();
    expect(container.textContent).toContain("onboardingBanner");
  });

  it("stays away once everything is answered, skipped or declined", async () => {
    mocks.data = journey("completed", "skipped", "declined");
    await render();
    expect(container.textContent).toBe("");
  });

  it("stays away on the journey itself and for people it cannot apply to", async () => {
    mocks.path = "/onboarding";
    await render();
    expect(container.textContent).toBe("");
    mocks.path = "/event";
    mocks.me = { id: 7, hasEventAccess: true, emailVerified: false };
    await render();
    expect(container.textContent).toBe("");
  });
});
