import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LibrariesSettingsPage from "./page";

const capability = vi.hoisted(() => ({ allowed: false }));

vi.mock("@/lib/session", () => ({ useCan: () => capability.allowed }));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/url-tab", () => ({ useUrlTab: () => ({ tab: "intolerances", setTab: vi.fn() }) }));
vi.mock("@/components/common/access-denied", () => ({
  AccessDenied: ({ ask }: { ask: string }) => <div data-testid="access-denied">{ask}</div>,
}));
vi.mock("@/components/common/page-layout", () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/components/common/page-header", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/components/common/tab-bar", () => ({
  TabBar: ({ children }: { children: React.ReactNode }) => <nav>{children}</nav>,
}));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));
vi.mock("./intolerances-manager", () => ({
  IntolerancesManager: () => <div data-testid="intolerances-manager" />,
}));
vi.mock("./shirt-sizes-manager", () => ({
  ShirtSizesManager: () => <div data-testid="shirt-sizes-manager" />,
}));
vi.mock("./universities-manager", () => ({
  UniversitiesManager: () => <div data-testid="universities-manager" />,
}));
vi.mock("./degrees-manager", () => ({
  DegreesManager: () => <div data-testid="degrees-manager" />,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => root.render(<LibrariesSettingsPage />));
}

beforeEach(() => {
  capability.allowed = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("LibrariesSettingsPage capability guard", () => {
  it("keeps the catalogue managers unmounted without intolerances:manage", async () => {
    await render();

    expect(container.querySelector("[data-testid=access-denied]")?.textContent).toBe(
      "noLibrariesAccessDesc",
    );
    expect(container.querySelector("[data-testid$=manager]")).toBeNull();
  });

  it("renders the managers when the required capability is present", async () => {
    capability.allowed = true;
    await render();

    expect(container.querySelector("[data-testid=intolerances-manager]")).not.toBeNull();
  });
});
