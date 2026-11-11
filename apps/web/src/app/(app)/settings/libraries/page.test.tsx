import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LibrariesSettingsPage from "./page";

const capability = vi.hoisted(() => ({ allowed: false, knowledge: false }));

vi.mock("@/lib/session", () => ({
  useCan: (name: string) =>
    name === "helpdesk:manage" ? capability.knowledge : capability.allowed,
}));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/url-tab", () => ({
  useUrlTab: ({ defaultValue }: { defaultValue: string }) => ({
    tab: defaultValue,
    setTab: vi.fn(),
  }),
}));
vi.mock("@/components/common/access-denied", () => ({
  AccessDenied: ({ ask }: { ask: string }) => <div data-testid="access-denied">{ask}</div>,
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
vi.mock("./knowledge-manager", () => ({
  KnowledgeManager: () => <div data-testid="knowledge-manager" />,
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
  capability.knowledge = false;
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

  it("gives the knowledge areas to helpdesk:manage alone, without the catalogues", async () => {
    capability.knowledge = true;
    await render();

    expect(container.querySelector("[data-testid=knowledge-manager]")).not.toBeNull();
    expect(container.querySelector("[data-testid=intolerances-manager]")).toBeNull();
  });
});
