import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const access = vi.hoisted(() => ({ canWrite: true }));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: { delete: vi.fn() },
  apiUpload: vi.fn(),
}));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/session", () => ({ useCan: () => access.canWrite }));
vi.mock("@/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { api, apiUpload } from "@/lib/api";
import type { UserDetail } from "@/lib/types";
import { UserPhoto } from "./user-photo";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

function person(image: string | null) {
  return { id: 42, name: "Ana", surname: "Pérez", email: "ana@x.test", image } as UserDetail;
}

beforeEach(() => {
  access.canWrite = true;
  vi.mocked(apiUpload).mockReset();
  vi.mocked(api.delete).mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const trigger = () => container.querySelector<HTMLButtonElement>("button[aria-label=profilePhoto]");
const items = () => [...document.querySelectorAll("[role=menuitem]")].map((i) => i.textContent);

async function openMenu() {
  const user = userEvent.setup();
  await act(async () => user.click(trigger() as HTMLButtonElement));
  return user;
}

describe("UserPhoto (#934, H8)", () => {
  it("shows only the photo to readers without users:write", async () => {
    access.canWrite = false;
    await act(async () => root.render(<UserPhoto user={person(null)} onChanged={vi.fn()} />));
    expect(trigger()).toBeNull();
    expect(container.querySelector("input[type=file]")).toBeNull();
  });

  it("uploads someone's photo through the staff route and reloads the record", async () => {
    const onChanged = vi.fn();
    vi.mocked(apiUpload).mockResolvedValue({ image: "/api/users/42/photo?v=abc" });
    await act(async () => root.render(<UserPhoto user={person(null)} onChanged={onChanged} />));
    const user = await openMenu();
    expect(items()).toEqual(["uploadPhoto"]);

    const input = container.querySelector("input[type=file]") as HTMLInputElement;
    const picked = vi.spyOn(input, "click");
    const upload = document.querySelector<HTMLElement>("[role=menuitem]");
    await act(async () => user.click(upload as HTMLElement));
    expect(picked).toHaveBeenCalled();

    const file = new File(["png"], "ana.png", { type: "image/png" });
    await act(async () => userEvent.setup({ pointerEventsCheck: 0 }).upload(input, file));
    expect(apiUpload).toHaveBeenCalledWith("/api/users/42/photo", expect.any(FormData));
    expect(onChanged).toHaveBeenCalled();
  });

  it("offers change and removal for a stored photo", async () => {
    const onChanged = vi.fn();
    vi.mocked(api.delete).mockResolvedValue({ image: null });
    await act(async () =>
      root.render(<UserPhoto user={person("/api/users/42/photo?v=abc")} onChanged={onChanged} />),
    );
    const user = await openMenu();
    expect(items()).toEqual(["changePhoto", "removePhoto"]);

    const remove = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find(
      (item) => item.textContent === "removePhoto",
    );
    await act(async () => user.click(remove as HTMLElement));
    expect(api.delete).toHaveBeenCalledWith("/api/users/42/photo");
    expect(onChanged).toHaveBeenCalled();
  });
});
