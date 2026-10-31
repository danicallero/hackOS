import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/profile",
  useRouter: () => ({ replace: nav.replace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/auth-client", () => ({ authClient: { changePassword: vi.fn() } }));

import { PasswordRow } from "./password-card";

describe("PasswordRow quick-search arrival (#1182)", () => {
  beforeEach(() => {
    nav.replace.mockClear();
    document.body.replaceChildren();
  });

  async function render(search: string) {
    nav.search = search;
    const container = document.createElement("div");
    document.body.append(container);
    await act(async () => {
      createRoot(container).render(
        <ul>
          <PasswordRow />
        </ul>,
      );
    });
  }

  it("opens the dialog and consumes the action param", async () => {
    await render("tab=account&action=password");
    expect(document.body.textContent).toContain("currentPassword");
    expect(nav.replace).toHaveBeenCalledTimes(1);
    expect(nav.replace).toHaveBeenCalledWith("/settings/profile?tab=account", { scroll: false });
  });

  it("stays closed without the action param", async () => {
    await render("tab=account");
    expect(document.body.textContent).not.toContain("currentPassword");
    expect(nav.replace).not.toHaveBeenCalled();
  });
});
