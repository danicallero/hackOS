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
vi.mock("./wallet-section", () => ({ WalletSection: () => <p>wallet-body</p> }));
vi.mock("./personal-details", () => ({
  PersonalDetails: ({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) => {
    useEffect(() => onDirtyChange(personal.dirty), [onDirtyChange]);
    return <p>personal-body</p>;
  },
}));
vi.mock("@/components/profile/public-profile-card", () => ({
  PublicProfileCard: () => <p>public-body</p>,
}));
vi.mock("./meals-section", () => ({ MealsSection: () => <p>meals-body</p> }));
vi.mock("./danger-zone", () => ({ DangerZone: () => <p>danger-body</p> }));
vi.mock("./email-card", () => ({ EmailRow: () => null }));
vi.mock("./password-card", () => ({ PasswordRow: () => null }));
vi.mock("./github-row", () => ({ GithubRow: () => null }));
vi.mock("./profile-roles", () => ({ ProfileRoles: () => <p>roles-body</p> }));

const personal = { dirty: false };

import ProfileSettingsPage from "./page";

const participant = {
  id: 7,
  name: "Ana",
  surname: "Pérez",
  email: "ana@example.com",
  emailVerified: true,
  visibleRoleName: "Hacker",
  hasEventAccess: true,
  isSponsorRep: false,
  roles: [{ id: 1, name: "Hacker", isVisible: true }],
};

describe("Profile tabs (H28, #1083)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    nav.search = "";
    personal.dirty = false;
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

  it("gives the participant Personal details, Public profile, Wallet and Account", async () => {
    await render();
    expect(tabs()).toEqual(["personalDetails", "publicProfileTitle", "wallet", "accountTitle"]);
    expect(openPanel()).toHaveLength(1);
    expect(openPanel()[0].textContent).toContain("personal-body");
    expect(openPanel()[0].textContent).not.toContain("public-body");
  });

  it("opens the public profile on its own tab", async () => {
    nav.search = "tab=public";
    await render();
    expect(openPanel()[0].textContent).toContain("public-body");
    expect(openPanel()[0].textContent).not.toContain("personal-body");
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
    expect(tabs()).toEqual(["personalDetails", "accountTitle"]);
    expect(container.textContent).not.toContain("public-body");
    expect(container.textContent).not.toContain("roles-body");
  });

  it("adds Meals to Personal details for a sponsor representative", async () => {
    session.me = { ...participant, isSponsorRep: true };
    await render();
    expect(openPanel()[0].textContent).toContain("meals-body");
  });

  it("keeps every tab mounted so a hidden draft survives switching", async () => {
    nav.search = "tab=account";
    await render();
    expect(openPanel()[0].textContent).toContain("danger-body");
    expect(container.textContent).toContain("personal-body");
  });

  it("marks a tab holding unsaved edits", async () => {
    personal.dirty = true;
    nav.search = "tab=wallet";
    await render();
    const profileTab = [...container.querySelectorAll("[role=tab]")][0];
    expect(profileTab.textContent).toContain("unsavedChanges");
  });

  it("writes no URL when the open tab is selected again (R003)", async () => {
    nav.search = "tab=personal";
    await render();
    const current = container.querySelector("[role=tab][data-state=active]") as HTMLElement;
    act(() => {
      current.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      current.click();
    });
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
