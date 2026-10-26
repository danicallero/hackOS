import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useInlineEditState } from "./use-inline-edit-state";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("inline edit session", () => {
  let container: HTMLDivElement;
  let root: Root;
  let state: ReturnType<typeof useInlineEditState>;

  function Cell({ value }: { value: string }) {
    state = useInlineEditState(value);
    return state.editing ? (
      <input ref={state.inputRef} value={state.draft} onChange={() => {}} />
    ) : (
      <span>{value}</span>
    );
  }

  function render(value: string) {
    act(() => root.render(<Cell value={value} />));
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("refreshes idle values but keeps an active draft through server updates and saving", () => {
    render("Initial");
    render("Server revision");
    expect(state.draft).toBe("Server revision");
    act(() => state.setEditing(true));
    expect(document.activeElement).toBe(container.querySelector("input"));
    act(() => state.setDraft("Local edit"));
    act(() => state.setSaving(true));
    render("Another revision");
    expect(state.draft).toBe("Local edit");
    expect(state.editing).toBe(true);
    expect(state.saving).toBe(true);
  });

  it("cancels to the latest server value and focuses again on the next edit", () => {
    render("Initial");
    act(() => state.setEditing(true));
    act(() => state.setDraft("Discard me"));
    render("Latest server value");
    act(() => state.setEditing(false));
    expect(state.draft).toBe("Latest server value");
    act(() => state.setEditing(true));
    expect(container.querySelector("input")?.value).toBe("Latest server value");
    expect(document.activeElement).toBe(container.querySelector("input"));
  });
});
