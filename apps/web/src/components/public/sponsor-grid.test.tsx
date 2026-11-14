import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicSponsor } from "./public-types";
import { SponsorGrid } from "./sponsor-grid";

let status = "authenticated";
vi.mock("@/lib/session", () => ({ useSessionContext: () => ({ status }) }));
vi.mock("@/components/common/sponsor-logo", () => ({
  SponsorLogo: ({ alt }: { alt: string }) => <i data-logo={alt} />,
}));
vi.mock("next/link", () => import("@/test/next-link-mock"));

const sponsors: PublicSponsor[] = [
  {
    enterpriseId: 7,
    name: "Acme",
    logoUrl: "https://cdn.test/acme.png",
    logoNegativeUrl: null,
    website: "https://acme.test",
  },
  { enterpriseId: 8, name: "Quiet", logoUrl: null, logoNegativeUrl: null, website: null },
];

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  status = "authenticated";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("SponsorGrid (H44, H45)", () => {
  it("opens each company page for signed-in viewers", async () => {
    await act(async () => root.render(<SponsorGrid sponsors={sponsors} />));
    const links = [...container.querySelectorAll("a")].map((a) => [
      a.getAttribute("aria-label"),
      a.getAttribute("href"),
      a.getAttribute("target"),
    ]);
    expect(links).toEqual([
      ["Acme", "/companies/7", null],
      ["Quiet", "/companies/8", null],
    ]);
  });

  it("keeps the website for anonymous visitors, who cannot read the company page", async () => {
    status = "unauthenticated";
    await act(async () => root.render(<SponsorGrid sponsors={sponsors} />));
    const links = [...container.querySelectorAll("a")];
    expect(links.map((a) => [a.getAttribute("href"), a.getAttribute("target")])).toEqual([
      ["https://acme.test", "_blank"],
    ]);
    expect(container.textContent).toContain("Quiet");
  });
});
