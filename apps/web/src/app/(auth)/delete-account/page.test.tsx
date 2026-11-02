import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DeleteAccountPage from "./page";

const state = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  t: (key: string) => key,
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("token=removal-token-0123456789"),
}));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: state.t }) }));
vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: { get: state.get, post: state.post },
}));

let container: HTMLDivElement;
let root: Root;

async function render() {
  await act(async () => {
    root.render(<DeleteAccountPage />);
  });
}

async function submit() {
  await act(async () => {
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  state.get.mockReset();
  state.post.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("delete-account page", () => {
  it("asks for the password and sends it when the account has one", async () => {
    state.get.mockResolvedValue({ email: "a@example.org", passwordRequired: true });
    state.post.mockResolvedValue({ deleted: true });
    await render();
    const input = container.querySelector<HTMLInputElement>('input[type="password"]');
    expect(input).not.toBeNull();

    await submit();
    expect(state.post).not.toHaveBeenCalled();

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(input, "secret");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submit();
    expect(state.post).toHaveBeenCalledWith("/api/unverified-account-removal", {
      token: "removal-token-0123456789",
      password: "secret",
    });
    expect(container.textContent).toContain("accountDeleted");
  });

  it("deletes without a password when the account has none", async () => {
    state.get.mockResolvedValue({ email: "a@example.org", passwordRequired: false });
    state.post.mockResolvedValue({ deleted: true });
    await render();
    expect(container.querySelector('input[type="password"]')).toBeNull();

    await submit();
    expect(state.post).toHaveBeenCalledWith("/api/unverified-account-removal", {
      token: "removal-token-0123456789",
    });
  });
});
