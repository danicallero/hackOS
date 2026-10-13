import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PermissionsPage from "./page";

vi.mock("@/lib/session", () => ({ useCan: () => false }));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/common/access-denied", () => ({
  AccessDenied: ({ ask }: { ask: string }) => <div data-testid="access-denied">{ask}</div>,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("PermissionsPage capability guard", () => {
  it("shows the denied state before mounting the permissions editor", async () => {
    await act(async () => root.render(<PermissionsPage />));

    expect(container.querySelector("[data-testid=access-denied]")?.textContent).toBe(
      "noPermissionsAccessDesc",
    );
    expect(container.querySelector("form")).toBeNull();
  });
});
