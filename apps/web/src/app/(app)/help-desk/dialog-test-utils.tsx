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

/** Module mocks shared by the dialog suites: load them from `vi.mock` with `await import`. */
export const apiMock = { api: { put: vi.fn() }, ApiError: class extends Error {} };
export const i18nMock = {
  useLocale: () => ({
    language: "en",
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
};
export const dateTimeInputMock = {
  DateTimeInput: ({ onChange, ...props }: { onChange: (value: string) => void }) => (
    <input {...props} onChange={(event) => onChange(event.target.value)} />
  ),
};

/** Two stated intervals on one event day, for the editors' fixtures. */
export const first = { startsAt: "2027-02-27T10:00:00.000Z", endsAt: "2027-02-27T12:00:00.000Z" };
export const second = { startsAt: "2027-02-27T14:00:00.000Z", endsAt: "2027-02-27T16:00:00.000Z" };
