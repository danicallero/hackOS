import { getByLabelText, getByRole } from "@testing-library/dom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, vi } from "vitest";
import { setEventTimeZone } from "@/lib/event-time";

/**
 * Shared setup for the From / To dialog tests (H62, H64): a fresh React root in
 * the event zone UTC for every test, handed to the suite through `onMount`.
 */
export function setupMountedRoot(onMount: (root: Root, container: HTMLDivElement) => void) {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.clearAllMocks();
    setEventTimeZone("UTC");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    onMount(root, container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
}

export const dialog = () => getByRole(document.body, "dialog");

/** Sets a dialog field the way a user edit does, so React sees the change. */
export async function typeInto(label: string, value: string) {
  const input = getByLabelText(dialog(), label) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
