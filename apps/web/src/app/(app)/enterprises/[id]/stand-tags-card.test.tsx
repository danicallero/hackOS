import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/lib/api";
import type { StandTag } from "./stand-tags-card";

const env = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));

vi.mock("@/lib/api", () => {
  class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return { api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() }, ApiError };
});
vi.mock("@/hooks/use-auto-refresh", () => ({ useAutoRefresh: () => 0 }));
vi.mock("@/lib/toast", () => ({ toast: { error: env.toastError, success: env.toastSuccess } }));
const t = (key: string) => key;
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t, language: "en" }) }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const del = vi.mocked(api.delete);
let tags: StandTag[];
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  tags = [];
  for (const mock of [get, post, del]) mock.mockReset();
  env.toastError.mockReset();
  env.toastSuccess.mockReset();
  get.mockImplementation((() => Promise.resolve({ tags })) as typeof api.get);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render() {
  const { StandTagsCard } = await import("./stand-tags-card");
  await act(async () => {
    root.render(<StandTagsCard enterpriseId={5} enterpriseName="Acme" />);
  });
}

function button(label: string) {
  return [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(label))!;
}

describe("StandTagsCard (#935)", () => {
  it("shows a single message without tags", async () => {
    await render();
    expect(get).toHaveBeenCalledWith("/api/enterprises/5/stand-tags");
    expect(container.textContent).toContain("standTagsEmpty");
  });

  it("links an NFC tag by its normalized UID", async () => {
    post.mockResolvedValue({
      id: 1,
      kind: "nfc",
      code: "04A1B2C3D4E5F6",
      createdAt: "2026-10-10T10:00:00.000Z",
    });
    await render();
    const user = userEvent.setup();
    await act(async () => user.type(container.querySelector("input")!, "04:a1:b2:c3:d4:e5:f6"));
    await act(async () => user.click(button("standTagLinkNfc")));
    expect(post).toHaveBeenCalledWith("/api/enterprises/5/stand-tags", {
      kind: "nfc",
      uid: "04A1B2C3D4E5F6",
    });
    expect(container.textContent).toContain("04A1B2C3D4E5F6");
    expect(container.querySelector("input")!.value).toBe("");
  });

  it("explains an invalid or already used UID inline", async () => {
    await render();
    const user = userEvent.setup();
    await act(async () => user.type(container.querySelector("input")!, "04A1"));
    await act(async () => user.click(button("standTagLinkNfc")));
    expect(post).not.toHaveBeenCalled();
    expect(container.textContent).toContain("standTagInvalidUid");

    const { ApiError } = await import("@/lib/api");
    post.mockRejectedValue(
      new (ApiError as unknown as new (s: number, c: string, m: string) => Error)(
        409,
        "conflict",
        "This tag is already in use",
      ),
    );
    await act(async () => user.clear(container.querySelector("input")!));
    await act(async () => user.type(container.querySelector("input")!, "04A1B2C3D4E5F6"));
    await act(async () => user.click(button("standTagLinkNfc")));
    expect(container.textContent).toContain("standTagInUse");
    expect(env.toastError).not.toHaveBeenCalled();
  });

  it("generates a printable QR and removes a tag after confirmation", async () => {
    post.mockResolvedValue({
      id: 2,
      kind: "qr",
      code: "STAND-ABCDEFGHJKMNPQRS",
      createdAt: "2026-10-10T10:00:00.000Z",
    });
    del.mockResolvedValue(undefined);
    await render();
    const user = userEvent.setup();
    await act(async () => user.click(button("standTagGenerateQr")));
    expect(post).toHaveBeenCalledWith("/api/enterprises/5/stand-tags", { kind: "qr" });
    expect(container.querySelector("li svg title")?.textContent).toBe("Acme QR");
    expect(button("standTagDownloadQr")).toBeDefined();

    await act(async () => user.click(button("remove")));
    expect(document.body.textContent).toContain("standTagRemoveQrDesc");
    const confirm = [...document.querySelectorAll('[role="alertdialog"] button')].find(
      (b) => b.textContent === "remove",
    ) as HTMLButtonElement;
    await act(async () => user.click(confirm));
    expect(del).toHaveBeenCalledWith("/api/enterprises/5/stand-tags/2");
    expect(container.textContent).toContain("standTagsEmpty");
  });
});
