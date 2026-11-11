import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const nav = vi.hoisted(() => ({
  search: "",
  replace: vi.fn(),
}));
const session = vi.hoisted(() => ({ me: null as unknown, isPureApplicant: false }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/profile",
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("@/lib/session", () => ({ useSessionContext: () => session }));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/common/page-layout", () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/common/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/components/certificates/certificates-panel", () => ({
  CertificatesPanel: () => <p>certificates-body</p>,
}));
vi.mock("@/components/profile/wallet-section", () => ({ WalletSection: () => <p>wallet-body</p> }));
vi.mock("@/components/profile/personal-details", () => ({
  PersonalDetails: ({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) => {
    useEffect(() => onDirtyChange(personal.dirty), [onDirtyChange]);
    return <p>personal-body</p>;
  },
}));
vi.mock("@/components/profile/public-profile-card", () => ({
  PublicProfileCard: () => <p>public-body</p>,
}));
const rsvps = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock("@/hooks/use-rsvps", () => ({ useRsvps: () => ({ items: rsvps.items }) }));
vi.mock("@/components/onboarding/catering-rsvp", () => ({
  CateringRsvpSection: () => <p>rsvp-body</p>,
}));
vi.mock("@/components/onboarding/onboarding-steps", () => ({ ShareCard: () => <p>share-body</p> }));
vi.mock("./mentoring-section", () => ({ MentoringSection: () => <p>mentor-body</p> }));
vi.mock("@/hooks/use-own-helper-profile", () => ({
  useOwnHelperProfile: () => ({ data: { eligible: helper.eligible } }),
}));
vi.mock("./active-devices", () => ({ ActiveDevices: () => <p>devices-body</p> }));
vi.mock("./danger-zone", () => ({ DangerZone: () => <p>danger-body</p> }));
vi.mock("./email-card", () => ({ EmailRow: () => null }));
vi.mock("./password-card", () => ({ PasswordRow: () => null }));
vi.mock("./github-row", () => ({ GithubRow: () => null }));
vi.mock("./profile-roles", () => ({ ProfileRoles: () => <p>roles-body</p> }));

const personal = { dirty: false };
const helper = { eligible: false };

import ProfileSettingsPage from "./page";

const participant = {
  id: 7,
  name: "Ana",
  surname: "Pérez",
  email: "ana@example.com",
  emailVerified: true,
  visibleRoleName: "Hacker",
  hasEventAccess: true,
  capabilities: [] as string[],
  isSponsorRep: false,
  roles: [{ id: 1, name: "Hacker", isVisible: true }],
};

describe("Profile tabs (H28, #1083)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    nav.search = "";
    personal.dirty = false;
    helper.eligible = false;
    session.me = { ...participant };
    session.isPureApplicant = false;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  async function render() {
    await act(async () => root.render(<ProfileSettingsPage />));
  }
  const tabs = () => [...container.querySelectorAll("[role=tab]")].map((tab) => tab.textContent);
  const openPanel = () =>
    [...container.querySelectorAll<HTMLElement>("[role=tabpanel]")].filter(
      (panel) => !panel.hidden,
    );

  it("gives the participant Public profile, Wallet and Account", async () => {
    await render();
    expect(tabs()).toEqual(["publicProfileTitle", "wallet", "preferences", "accountTitle"]);
    expect(openPanel()).toHaveLength(1);
    expect(openPanel()[0].textContent).toContain("public-body");
    expect(openPanel()[0].textContent).not.toContain("personal-body");
  });

  it("names every section with an h2 so its h3s never skip a level (#1176)", async () => {
    nav.search = "tab=wallet";
    await render();
    const headings = [...openPanel()[0].querySelectorAll("section > h2")];
    expect(headings.map((h) => [h.textContent, h.className])).toEqual([
      ["wallet", "sr-only"],
      ["onboardingStepShare", "type-section-title"],
      ["certificates", "type-section-title"],
    ]);
    for (const section of openPanel()[0].querySelectorAll("section[aria-labelledby]")) {
      const label = document.getElementById(section.getAttribute("aria-labelledby") ?? "");
      expect(section.contains(label)).toBe(true);
    }
  });

  it("opens the public profile on its own tab", async () => {
    nav.search = "tab=public";
    await render();
    expect(openPanel()[0].textContent).toContain("public-body");
    expect(openPanel()[0].textContent).not.toContain("danger-body");
  });

  it("puts the personal details first in Account", async () => {
    nav.search = "tab=account";
    await render();
    expect(openPanel()[0].textContent).toContain("personal-body");
  });

  it("opens Account for the old ?tab=personal link", async () => {
    nav.search = "tab=personal";
    await render();
    expect(openPanel()[0].textContent).toContain("personal-body");
  });

  it("keeps the passes and certificates together in Wallet", async () => {
    nav.search = "tab=wallet";
    await render();
    expect(openPanel()[0].textContent).toContain("wallet-body");
    expect(openPanel()[0].textContent).toContain("certificates-body");
  });

  it("drops Wallet and event-only sections for a pure applicant", async () => {
    session.me = { ...participant, hasEventAccess: false, roles: [] };
    session.isPureApplicant = true;
    await render();
    expect(tabs()).toEqual(["preferences", "accountTitle"]);
    expect(container.textContent).not.toContain("public-body");
    expect(container.textContent).not.toContain("roles-body");
  });

  it("puts an eligible helper's help desk settings in the Mentoring tab (H61)", async () => {
    helper.eligible = true;
    nav.search = "tab=mentoring";
    await render();
    expect(tabs()).toContain("profileMentoringTitle");
    expect(openPanel()[0].textContent).toContain("mentor-body");
    expect(openPanel()[0].textContent).not.toContain("public-body");
  });

  it("opens the Mentoring tab for the old ?tab=help-desk link (H61)", async () => {
    helper.eligible = true;
    nav.search = "tab=help-desk";
    await render();
    expect(openPanel()[0].textContent).toContain("mentor-body");
  });

  it("lets an accepted mentor without event access prepare their mentoring (H61)", async () => {
    session.me = { ...participant, hasEventAccess: false, roles: [] };
    session.isPureApplicant = true;
    helper.eligible = true;
    nav.search = "tab=mentoring";
    await render();
    expect(tabs()).toEqual(["profileMentoringTitle", "preferences", "accountTitle"]);
    expect(openPanel()[0].textContent).toContain("mentor-body");
  });

  it("adds the Attendance tab only while the person has open RSVPs", async () => {
    rsvps.items = [{ activityId: 1 }];
    nav.search = "tab=attendance";
    await render();
    expect(tabs()).toContain("profileRsvpTitle");
    expect(openPanel()[0].textContent).toContain("rsvp-body");
    rsvps.items = [];
    await render();
    expect(tabs()).not.toContain("profileRsvpTitle");
  });

  it("lets the person revisit the share card from the Wallet tab", async () => {
    nav.search = "tab=wallet";
    await render();
    expect(container.textContent).toContain("share-body");
  });

  it("adds the Mentoring tab only for holders of the capability", async () => {
    session.me = { ...participant, capabilities: ["helpdesk:offer"] };
    nav.search = "tab=mentoring";
    await render();
    expect(container.textContent).toContain("mentor-body");
    session.me = { ...participant, capabilities: ["*"] };
    await render();
    expect(container.textContent).toContain("mentor-body");
    session.me = participant;
    await render();
    expect(tabs()).not.toContain("profileMentoringTitle");
    expect(container.textContent).not.toContain("mentor-body");
  });

  const openTab = async (index: number) => {
    const trigger = container.querySelectorAll("[role=tab]")[index] as HTMLElement;
    await act(async () => {
      trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      trigger.click();
    });
  };

  it("mounts a tab only once it is opened, then keeps it so a hidden draft survives (#1227)", async () => {
    await render();
    expect(container.textContent).toContain("public-body");
    expect(container.textContent).not.toContain("danger-body");
    await openTab(3);
    expect(openPanel()[0].textContent).toContain("danger-body");
    expect(container.textContent).toContain("public-body");
  });

  it("marks a tab holding unsaved edits", async () => {
    personal.dirty = true;
    await render();
    await openTab(3);
    await openTab(0);
    const profileTab = [...container.querySelectorAll("[role=tab]")][3];
    expect(profileTab.textContent).toContain("unsavedChanges");
  });

  it("writes no URL when the open tab is selected again (R003)", async () => {
    nav.search = "tab=public";
    await render();
    const current = container.querySelector("[role=tab][data-state=active]") as HTMLElement;
    act(() => {
      current.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      current.click();
    });
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
