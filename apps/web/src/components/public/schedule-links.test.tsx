import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicScheduleItem } from "@/lib/logistics";
import { CompanyMarks, ScheduleLinks, ScheduleLinksDetail, SpeakerStack } from "./schedule-links";

vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key, language: "en" }) }));
let status = "authenticated";
vi.mock("@/lib/session", () => ({ useSessionContext: () => ({ status }) }));
vi.mock("@/components/common/user-avatar", () => ({
  UserAvatar: ({ name }: { name: string }) => <i data-avatar={name} />,
}));
vi.mock("@/components/common/sponsor-logo", () => ({
  SponsorLogo: ({ alt }: { alt: string }) => <i data-logo={alt} />,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

type Links = Pick<PublicScheduleItem, "speakers" | "enterprises">;
const speakers = (n: number): NonNullable<Links["speakers"]> =>
  Array.from({ length: n }, (_, i) => ({
    userId: i + 1,
    name: `Speaker ${i + 1}`,
    avatarUrl: null,
    enterprises: i === 0 ? [{ id: 7, name: "Acme" }] : [],
  }));

let container: HTMLDivElement;
let root: Root;
const show = (node: React.ReactNode) => act(async () => root.render(node));
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

describe("SpeakerStack", () => {
  it.each([
    [1, 1, 0],
    [3, 3, 0],
    [15, 4, 11],
  ])("%i speakers show %i avatars and +%i overflow", async (count, avatars, rest) => {
    await show(<SpeakerStack speakers={speakers(count)} />);
    expect(container.querySelectorAll("[data-avatar]")).toHaveLength(avatars);
    expect(container.textContent).toBe(rest ? `+${rest}` : "");
    // The full list stays available to assistive tech and hover.
    expect(container.querySelector("[role=img]")?.getAttribute("aria-label")).toContain(
      `Speaker ${count}`,
    );
  });
});

describe("CompanyMarks", () => {
  it("shows logos and counts the overflow", async () => {
    await show(
      <CompanyMarks
        enterprises={[1, 2, 3, 4, 5].map((id) => ({
          id,
          name: `C${id}`,
          logoUrl: `https://x/${id}.png`,
        }))}
      />,
    );
    expect(container.querySelectorAll("[data-logo]")).toHaveLength(3);
    expect(container.textContent).toBe("+2");
  });
});

describe("ScheduleLinks (rows)", () => {
  it("names one or two speakers and collapses 15 into the stack", async () => {
    await show(<ScheduleLinks item={{ speakers: speakers(2) }} />);
    expect(container.textContent).toContain("Speaker 1, Speaker 2");
    await show(<ScheduleLinks item={{ speakers: speakers(15) }} />);
    expect(container.textContent).not.toContain("Speaker 1,");
    expect(container.textContent).toContain("+11");
  });

  it("renders nothing without links", async () => {
    await show(<ScheduleLinks item={{ speakers: [], enterprises: [] }} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("ScheduleLinksDetail", () => {
  it("lists all 15 speakers with their companies and links signed-in viewers to profiles", async () => {
    await show(
      <ScheduleLinksDetail
        item={{
          speakers: speakers(15),
          enterprises: [{ id: 7, name: "Acme", logoUrl: null }],
        }}
      />,
    );
    expect(container.querySelectorAll('a[href^="/people/"]')).toHaveLength(15);
    expect(container.querySelector('a[href="/companies/7"]')).not.toBeNull();
    expect(container.textContent).toContain("Speaker 15");
  });

  it("does not link signed-out viewers to pages that need a session", async () => {
    status = "unauthenticated";
    await show(<ScheduleLinksDetail item={{ speakers: speakers(3) }} />);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.textContent).toContain("Speaker 3");
  });
});
