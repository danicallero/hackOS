import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyProfile } from "@/lib/company";
import { CompanyView } from "./company-profile";

vi.mock("@/hooks/use-server-resource", () => ({ useServerResource: () => ({ data: undefined }) }));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key, language: "en" }) }));

const company = (overrides: Partial<CompanyProfile> = {}): CompanyProfile => ({
  id: 7,
  name: "Acme Example Labs",
  logoUrl: null,
  logoNegativeUrl: null,
  website: null,
  description: null,
  representatives: [],
  challenges: [],
  activities: [],
  ...overrides,
});

let root: Root;
let node: HTMLDivElement;
beforeEach(() => {
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});

const render = (value: CompanyProfile) =>
  act(async () => root.render(<CompanyView company={value} context={null} />));
const layers = () => [...node.querySelectorAll<HTMLImageElement>("[data-hero-ambient] img")];

describe("company hero ambient backdrop (H44, H48)", () => {
  it("blurs the logo the tile shows, the negative one in dark mode", async () => {
    await render(
      company({
        logoUrl: "https://cdn.test/acme.png",
        logoNegativeUrl: "https://cdn.test/acme-neg.png",
      }),
    );
    const light = node.querySelector("[data-hero-ambient] img[data-active]");
    const dark = node.querySelector("[data-hero-ambient] img[data-active-dark]");
    expect(light?.getAttribute("src")).toBe("https://cdn.test/acme.png");
    expect(light?.className).toContain("dark:opacity-0");
    expect(dark?.getAttribute("src")).toBe("https://cdn.test/acme-neg.png");
    expect(dark?.className).toContain("dark:opacity-100");
    // Same plain request as the logo tile.
    expect(layers().every((img) => !img.hasAttribute("crossorigin"))).toBe(true);
  });

  it("uses the one logo in both themes when there is no negative", async () => {
    await render(company({ logoUrl: "https://cdn.test/acme.png" }));
    expect(layers().map((img) => img.getAttribute("src"))).toEqual(["https://cdn.test/acme.png"]);
    expect(layers()[0]?.dataset).toMatchObject({ active: "true", activeDark: "true" });
  });

  it("keeps the single-color wash without a logo", async () => {
    await render(company());
    expect(node.querySelector("[data-hero-bleed]")).not.toBeNull();
    expect(node.querySelector("[data-hero-ambient]")).toBeNull();
  });
});
