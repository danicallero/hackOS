import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PasswordInput } from "./password-input";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string) =>
      ({ showPassword: "Show password", hidePassword: "Hide password" })[key] ?? key,
  }),
}));

describe("PasswordInput", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<PasswordInput aria-label="Password" />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps the visibility toggle keyboard reachable and exposes its state", async () => {
    const user = userEvent.setup();
    const input = container.querySelector("input");
    const toggle = container.querySelector<HTMLButtonElement>("button");

    expect(input?.type).toBe("password");
    expect(toggle?.getAttribute("tabindex")).toBeNull();
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
    expect(toggle?.getAttribute("aria-label")).toBe("Show password");

    await act(async () => user.click(toggle as HTMLButtonElement));

    expect(input?.type).toBe("text");
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    expect(toggle?.getAttribute("aria-label")).toBe("Hide password");
  });
});
