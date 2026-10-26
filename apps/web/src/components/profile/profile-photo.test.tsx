import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({
  me: { id: 7, name: "Ana", surname: "Pérez", image: null as string | null },
  refresh: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: { delete: vi.fn() },
  apiUpload: vi.fn(),
}));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/session", () => ({ useSessionContext: () => session }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ProfilePhoto } from "@/components/profile/profile-photo";
import { api, apiUpload } from "@/lib/api";
import { toast } from "@/lib/toast";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  session.me.image = null;
  session.refresh.mockReset();
  vi.mocked(apiUpload).mockReset();
  vi.mocked(api.delete).mockReset();
  vi.mocked(toast.error).mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const buttons = () => [...container.querySelectorAll("button")].map((b) => b.textContent);

describe("ProfilePhoto (#934)", () => {
  it("uploads a photo and refreshes the session", async () => {
    vi.mocked(apiUpload).mockResolvedValue({ image: "/api/users/7/photo?v=abc" });
    await act(async () => root.render(<ProfilePhoto />));
    expect(buttons()).toEqual([""]);
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("uploadPhoto");

    const user = userEvent.setup();
    const file = new File(["png"], "me.png", { type: "image/png" });
    await act(async () =>
      user.upload(container.querySelector("input[type=file]") as HTMLInputElement, file),
    );
    expect(apiUpload).toHaveBeenCalledWith("/api/me/photo", expect.any(FormData));
    expect(session.refresh).toHaveBeenCalled();
  });

  it("refuses unsupported or oversize files before uploading", async () => {
    await act(async () => root.render(<ProfilePhoto />));
    const user = userEvent.setup({ applyAccept: false });
    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    await act(async () => user.upload(input, new File(["gif"], "a.gif", { type: "image/gif" })));
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "a.png", { type: "image/png" });
    await act(async () => user.upload(input, big));
    expect(apiUpload).not.toHaveBeenCalled();
    expect(container.querySelector("[role=alert]")?.textContent).toBe("photoFileHint");
  });

  it("opens a change/remove menu from the camera button for a stored photo", async () => {
    session.me.image = "/api/users/7/photo?v=abc";
    vi.mocked(api.delete).mockResolvedValue({ image: null });
    await act(async () => root.render(<ProfilePhoto />));
    expect(buttons()).toEqual([""]);

    const user = userEvent.setup();
    const trigger = container.querySelector("button") as HTMLButtonElement;
    expect(trigger.getAttribute("aria-label")).toBe("changePhoto");
    await act(async () => user.click(trigger));
    const items = [...document.querySelectorAll("[role=menuitem]")].map((i) => i.textContent);
    expect(items).toEqual(["changePhoto", "removePhoto"]);

    const remove = [...document.querySelectorAll("[role=menuitem]")][1] as HTMLElement;
    await act(async () => user.click(remove));
    expect(api.delete).toHaveBeenCalledWith("/api/me/photo");
    expect(session.refresh).toHaveBeenCalled();
  });
});
