import { StarIcon } from "@phosphor-icons/react/dist/csr/Star";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorRow } from "./title-first-form";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => state.mobile }));
const state = vi.hoisted(() => ({ mobile: false }));

describe("EditorRow", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    state.mobile = false;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows the add affordance when empty and the value when set", () => {
    act(() => root.render(<EditorRow icon={StarIcon} label="Prizes" />));
    expect(container.textContent).toContain("addRow");
    act(() => root.render(<EditorRow icon={StarIcon} label="Prizes" value="2 prizes" />));
    expect(container.textContent).toContain("2 prizes");
  });

  it("opens its editor and closes it with Done", async () => {
    const user = userEvent.setup();
    act(() =>
      root.render(
        <EditorRow icon={StarIcon} label="Prizes">
          <input aria-label="inner" />
        </EditorRow>,
      ),
    );
    await user.click(container.querySelector("button") as HTMLButtonElement);
    expect(document.body.querySelector('[aria-label="inner"]')).not.toBeNull();
    await user.click(
      [...document.body.querySelectorAll("button")].find(
        (b) => b.textContent === "done",
      ) as HTMLElement,
    );
    expect(document.body.querySelector('[aria-label="inner"]')).toBeNull();
  });

  it("opens a bottom sheet on narrow screens", async () => {
    state.mobile = true;
    const user = userEvent.setup();
    act(() =>
      root.render(
        <EditorRow icon={StarIcon} label="Prizes">
          <input aria-label="inner" />
        </EditorRow>,
      ),
    );
    await user.click(container.querySelector("button") as HTMLButtonElement);
    expect(document.body.querySelector('[data-slot="sheet-content"]')).not.toBeNull();
  });

  it("renders the error under the row", () => {
    act(() => root.render(<EditorRow icon={StarIcon} label="Team" error="Required" />));
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Required");
  });
});
