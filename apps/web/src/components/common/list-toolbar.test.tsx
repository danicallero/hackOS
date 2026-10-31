import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => true }));
vi.mock("@/components/common/filter-menu", () => ({
  FilterMenu: ({ chipsClassName }: { chipsClassName?: string }) => (
    <div data-testid="filters" data-chips={chipsClassName} />
  ),
}));

import { ListToolbar } from "./list-toolbar";

function render(searchOwnRowOnMobile: boolean) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() =>
    createRoot(container).render(
      <ListToolbar
        search={{ label: "Search", value: "", onValueChange: () => {} }}
        filters={[{ id: "kind" } as never]}
        actions={<button type="button">Export</button>}
        searchOwnRowOnMobile={searchOwnRowOnMobile}
      />,
    ),
  );
  return container;
}

describe("ListToolbar", () => {
  it("keeps the inline search by default", () => {
    const toolbar = render(false).querySelector("section");
    expect(toolbar?.className).not.toContain("max-sm:grid-cols");
    expect(toolbar?.querySelector("input")?.parentElement?.className).not.toContain(
      "col-span-full",
    );
  });

  it("gives the search its own row on mobile and moves chips below the actions (#1178)", () => {
    const container = render(true);
    expect(container.querySelector("section")?.className).toContain(
      "max-sm:grid-cols-[auto_minmax(0,1fr)]",
    );
    expect(container.querySelector("input")?.parentElement?.className).toContain(
      "max-sm:col-span-full",
    );
    expect(container.querySelector("[data-testid=filters]")?.getAttribute("data-chips")).toContain(
      "max-sm:row-start-3",
    );
  });
});
