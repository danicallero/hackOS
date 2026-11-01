import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  me: {
    id: 7,
    name: "Lucía" as string | null,
    surname: "Fernández Otero" as string | null,
    email: "lucia@example.com",
    image: null as string | null,
    visibleRoleName: "participant",
  },
  refresh: vi.fn(),
}));

vi.mock("@/lib/session", () => ({ useSessionContext: () => session }));
vi.mock("@/lib/env", () => ({ API_URL: "https://api.example" }));
vi.mock("@/lib/auth-client", () => ({ signOut: vi.fn() }));
vi.mock("@/lib/i18n", () => ({
  languageName: (language: string) => language,
  useLocale: () => ({ language: "en", setLanguage: vi.fn(), t: (key: string) => key }),
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ setTheme: vi.fn(), theme: "light" }) }));
vi.mock("@/components/ui/sidebar", () => ({ useSidebar: () => ({ state: "expanded" }) }));
// Radix only mounts the <img> after the browser loads it, which jsdom never does.
vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children, ...props }: { children: ReactNode }) => (
    <span data-slot="avatar" {...props}>
      {children}
    </span>
  ),
  // biome-ignore lint/performance/noImgElement: a test double for Radix's image slot.
  AvatarImage: ({ src, alt }: { src: string; alt: string }) => <img src={src} alt={alt} />,
  AvatarFallback: ({ children }: { children: ReactNode }) => (
    <span data-slot="avatar-fallback">{children}</span>
  ),
}));

import { UserMenu } from "./user-menu";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  session.me.image = null;
  session.me.name = "Lucía";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const trigger = () => container.querySelector("button") as HTMLButtonElement;

describe("UserMenu account photo (#934)", () => {
  it("shows the account photo beside the name and email", async () => {
    session.me.image = "/api/users/7/photo?v=abc";
    await act(async () => root.render(<UserMenu />));
    const image = trigger().querySelector("img");
    expect(image?.getAttribute("src")).toBe("https://api.example/api/users/7/photo?v=abc");
    // The name is visible text, so the photo is decorative here.
    expect(image?.getAttribute("alt")).toBe("");
    expect(trigger().getAttribute("aria-label")).toBe("Lucía lucia@example.com");
  });

  it("stays text-first without a photo: no initials avatar is fabricated", async () => {
    await act(async () => root.render(<UserMenu />));
    expect(trigger().querySelector('[data-slot="avatar"]')).toBeNull();
    // H55: the visible name/email must also occur, with spacing, in the accessible name.
    expect(trigger().textContent).toBe("Lucía lucia@example.com");
    // The icon only appears on the collapsed rail, where the text is hidden.
    expect(trigger().querySelector("svg")?.getAttribute("class")).toContain(
      "group-data-[collapsible=icon]:block",
    );

    session.me.name = null;
    await act(async () => root.render(<UserMenu />));
    expect(trigger().getAttribute("aria-label")).toBe("lucia@example.com");
    expect(trigger().textContent).toBe("lucia@example.com");

    const user = userEvent.setup();
    await act(async () => user.click(trigger()));
    expect(document.querySelector('[role="menu"] [data-slot="avatar"]')).toBeNull();
  });

  it("repeats the photo with the full name in the open menu", async () => {
    session.me.image = "/api/users/7/photo?v=abc";
    await act(async () => root.render(<UserMenu />));
    const user = userEvent.setup();
    await act(async () => user.click(trigger()));
    const menu = document.querySelector('[role="menu"]');
    expect(menu?.textContent).toContain("Lucía Fernández Otero");
    expect(menu?.querySelector("img")?.getAttribute("src")).toBe(
      "https://api.example/api/users/7/photo?v=abc",
    );
  });
});
