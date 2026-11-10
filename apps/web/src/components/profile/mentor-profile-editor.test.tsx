import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MentorProfile } from "@/lib/mentor-profile";

const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/mentor-profile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mentor-profile")>()),
  readMentorProfile: mocks.read,
  saveMentorProfile: mocks.save,
}));
vi.mock("@/lib/api", () => ({ api: { get: mocks.get } }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/hooks/use-unsaved-changes-guard", () => ({ useUnsavedChangesGuard: () => undefined }));
vi.mock("@/hooks/use-server-resource", () => ({
  useServerResource: (
    key: unknown[],
    fetcher: (s: AbortSignal) => Promise<unknown>,
    o?: { enabled?: boolean },
  ) => {
    const [data, setData] = useState<unknown>(null);
    const k = JSON.stringify(key);
    // biome-ignore lint/correctness/useExhaustiveDependencies: key identifies the resource.
    useEffect(() => {
      if (o?.enabled === false) return;
      void fetcher(new AbortController().signal).then(setData);
    }, [k, o?.enabled]);
    return { data, error: null, loading: !data, reload: () => undefined, mutate: setData };
  },
}));
vi.mock("@/components/common/library-picker", () => ({
  LibraryPicker: ({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) => (
    <div>
      <span data-testid="names">{value.join("|")}</span>
      <button type="button" onClick={() => onChange([...value, "Rust"])}>
        add-rust
      </button>
    </div>
  ),
}));

import { MentorProfileEditor } from "@/components/profile/mentor-profile-editor";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const profile = (over: Partial<MentorProfile> = {}): MentorProfile => ({
  eligible: true,
  published: false,
  libraryId: "lib-1",
  expertise: [{ id: 1, label: "Design" }],
  ...over,
});

let container: HTMLDivElement;
let root: Root;
const mount = async (onSaved = vi.fn()) => {
  await act(async () => root.render(<MentorProfileEditor onSaved={onSaved} />));
  await act(async () => undefined);
  return onSaved;
};

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.get.mockResolvedValue({
    items: [
      { id: 1, name: "Design" },
      { id: 2, name: "Rust" },
    ],
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("MentorProfileEditor", () => {
  it("renders nothing for a person who cannot offer help, keeping their data server-side", async () => {
    mocks.read.mockResolvedValue(profile({ eligible: false, published: true }));
    await mount();
    expect(container.textContent).toBe("");
  });

  it("saves publication and expertise ids, independent of any networking choice", async () => {
    mocks.read.mockResolvedValue(profile());
    mocks.save.mockResolvedValue(profile({ published: true }));
    const onSaved = await mount();
    await act(async () =>
      (container.querySelector("button[role=switch]") as HTMLButtonElement).click(),
    );
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "add-rust")
        ?.click(),
    );
    await act(async () =>
      container
        .querySelector("form")
        ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(mocks.save).toHaveBeenCalledWith(true, [1, 2]);
    expect(onSaved).toHaveBeenCalled();
  });

  it("offers one always-enabled primary action in a guided flow and hides the save status", async () => {
    mocks.read.mockResolvedValue(profile());
    mocks.save.mockResolvedValue(profile());
    const onSaved = vi.fn();
    await act(async () =>
      root.render(<MentorProfileEditor onSaved={onSaved} submitLabel="Continue" />),
    );
    await act(async () => undefined);
    const submit = container.querySelector<HTMLButtonElement>("button[type=submit]");
    expect(submit?.textContent).toContain("Continue");
    expect(submit?.disabled).toBe(false);
    expect(container.textContent).not.toContain("unsavedChanges");
  });
});
