import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MentorProfile } from "@/lib/mentor-profile";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  putHelper: vi.fn(),
  helper: null as unknown,
}));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/mentor-profile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mentor-profile")>()),
  readMentorProfile: mocks.read,
  saveMentorProfile: mocks.save,
}));
vi.mock("@/lib/api", () => ({ api: { put: mocks.putHelper } }));
vi.mock("@/lib/session", () => ({ useSessionContext: () => ({ canAny: () => false }) }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn() } }));
vi.mock("@/hooks/use-unsaved-changes-guard", () => ({ useUnsavedChangesGuard: () => undefined }));
vi.mock("@/hooks/use-own-helper-profile", () => ({
  useHelperProfileOf: () => ({ data: mocks.helper, loading: false, mutate: vi.fn() }),
}));
vi.mock("@/hooks/use-server-resource", () => ({
  useServerResource: (key: unknown[], fetcher: (s: AbortSignal) => Promise<unknown>) => {
    const [data, setData] = useState<unknown>(null);
    const k = JSON.stringify(key);
    // biome-ignore lint/correctness/useExhaustiveDependencies: key identifies the resource.
    useEffect(() => {
      void fetcher(new AbortController().signal).then(setData);
    }, [k]);
    return { data, error: null, loading: !data, reload: () => undefined, mutate: setData };
  },
}));
vi.mock("@/app/(app)/help-desk/shared", () => ({
  TopicsPicker: ({
    value,
    onChange,
  }: {
    value: { id: number; name: string }[];
    onChange: (v: { id: number; name: string }[]) => void;
  }) => (
    <div>
      <span data-testid="topics">{value.map((topic) => topic.name).join("|")}</span>
      <button type="button" onClick={() => onChange([...value, { id: 9, name: "Rust" }])}>
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
  expertise: [],
  ...over,
});
const helperProfile = (over: Record<string, unknown> = {}) => ({
  eligible: true,
  published: false,
  topics: [{ id: 5, name: "Design" }],
  challengeIds: [3],
  challengeOptions: [],
  preview: { userId: 7 },
  ...over,
});

let container: HTMLDivElement;
let root: Root;
const mount = async (onSaved = vi.fn()) => {
  await act(async () => root.render(<MentorProfileEditor onSaved={onSaved} />));
  await act(async () => undefined);
  return onSaved;
};
const submit = () =>
  act(async () =>
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
const click = (label: string) =>
  act(async () =>
    [...container.querySelectorAll("button")].find((b) => b.textContent === label)?.click(),
  );

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
  for (const mock of [mocks.read, mocks.save, mocks.putHelper]) mock.mockReset();
  mocks.helper = helperProfile();
  mocks.putHelper.mockResolvedValue(helperProfile());
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("MentorProfileEditor", () => {
  it("renders nothing for a person who can neither mentor nor help", async () => {
    mocks.read.mockResolvedValue(profile({ eligible: false, published: true }));
    mocks.helper = helperProfile({ eligible: false });
    await mount();
    expect(container.textContent).toBe("");
  });

  it("publishes the mentor and help desk profiles with one switch and saves the areas", async () => {
    mocks.read.mockResolvedValue(profile());
    mocks.save.mockResolvedValue(profile({ published: true }));
    const onSaved = await mount();
    expect(container.querySelectorAll("button[role=switch]")).toHaveLength(1);
    await act(async () =>
      (container.querySelector("button[role=switch]") as HTMLButtonElement).click(),
    );
    await click("add-rust");
    await submit();
    expect(mocks.save).toHaveBeenCalledWith(true, undefined);
    expect(mocks.putHelper).toHaveBeenCalledWith("/api/me/helper-profile", {
      published: true,
      topicIds: [5, 9],
      challengeIds: [3],
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it("offers one always-enabled primary action in a guided flow and hides the save status", async () => {
    mocks.read.mockResolvedValue(profile());
    await act(async () =>
      root.render(<MentorProfileEditor onSaved={vi.fn()} submitLabel="Continue" />),
    );
    await act(async () => undefined);
    const button = container.querySelector<HTMLButtonElement>("button[type=submit]");
    expect(button?.textContent).toContain("Continue");
    expect(button?.disabled).toBe(false);
    expect(container.textContent).not.toContain("unsavedChanges");
  });

  it("writes a person's profile through the user-management routes, and can only unpublish", async () => {
    mocks.read.mockResolvedValue(profile({ published: true }));
    mocks.save.mockResolvedValue(profile({ published: false }));
    mocks.helper = helperProfile({ published: true });
    await act(async () => root.render(<MentorProfileEditor subjectId={42} />));
    await act(async () => undefined);
    const toggle = container.querySelector("button[role=switch]") as HTMLButtonElement;
    expect(toggle.disabled).toBe(false);
    await act(async () => toggle.click());
    await submit();
    expect(mocks.save).toHaveBeenCalledWith(false, 42);
    expect(mocks.putHelper.mock.calls[0][0]).toBe("/api/users/42/helper-profile");
  });

  it("does not let user management publish a person who has not", async () => {
    mocks.read.mockResolvedValue(profile());
    await act(async () => root.render(<MentorProfileEditor subjectId={42} />));
    await act(async () => undefined);
    expect(container.querySelector<HTMLButtonElement>("button[role=switch]")?.disabled).toBe(true);
    expect(container.textContent).toContain("mentorPublishOwnConsent");
  });
});
