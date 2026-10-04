import { fireEvent, getByRole } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IconButton } from "../common/icon-button";
import { SubmitButton } from "../common/submit-button";
import { Button } from "./button";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("shared button availability", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps the action name while loading and prevents repeat form submissions", async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const onClick = vi.fn();
    const render = (pending: boolean, disabled = false) => act(() => root.render(
      <form onSubmit={onSubmit}>
        <SubmitButton pending={pending} disabled={disabled} onClick={onClick}>Save changes</SubmitButton>
      </form>,
    ));
    render(true);
    const button = getByRole(container, "button", { name: "Save changes" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.querySelector('[data-slot="button-spinner"]')?.getAttribute("aria-hidden")).toBe("true");
    await act(async () => userEvent.setup().click(button));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
    render(false, true);
    expect(button.disabled).toBe(true);
    expect(button.querySelector('[data-slot="button-spinner"]')).toBeNull();
    render(false);
    expect(button.disabled).toBe(false);
    await act(async () => userEvent.setup().click(button));
    expect(onClick).toHaveBeenCalledOnce();
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("blocks pointer, auxiliary and keyboard activation of an unavailable composed link", () => {
    const onClick = vi.fn();
    const onCapture = vi.fn();
    const onAuxClick = vi.fn();
    const onKeyDown = vi.fn();
    act(() => root.render(
      <Button asChild disabled onClickCapture={onCapture}>
        <a href="#destination" onClick={onClick} onAuxClick={onAuxClick} onKeyDown={onKeyDown}>Open schedule</a>
      </Button>,
    ));
    const link = getByRole(container, "link", { name: "Open schedule" });
    expect(link.getAttribute("aria-disabled")).toBe("true");
    expect(link.hasAttribute("disabled")).toBe(false);
    expect(fireEvent.click(link)).toBe(false);
    expect(fireEvent.click(link, { ctrlKey: true })).toBe(false);
    expect(fireEvent(link, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }))).toBe(false);
    expect(fireEvent.keyDown(link, { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(link, { key: " " })).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
    expect(onCapture).not.toHaveBeenCalled();
    expect(onAuxClick).not.toHaveBeenCalled();
    expect(onKeyDown).not.toHaveBeenCalled();
    fireEvent.keyDown(link, { key: "Tab" });
    expect(onKeyDown).toHaveBeenCalledOnce();
  });

  it("keeps enabled link semantics and child event handlers through loading changes", () => {
    const onClick = vi.fn((event: React.MouseEvent) => event.preventDefault());
    const render = (loading: boolean) => act(() => root.render(
      <Button asChild variant="outline" loading={loading}>
        <a href="#destination" onClick={onClick}>Open schedule</a>
      </Button>,
    ));
    render(true);
    const link = getByRole(container, "link", { name: "Open schedule" });
    expect(link.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(link);
    expect(onClick).not.toHaveBeenCalled();
    render(false);
    expect(link.hasAttribute("aria-disabled")).toBe(false);
    fireEvent.click(link);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("retains icon-only names and shares availability across every variant", () => {
    act(() => root.render(<>
      <IconButton label="Remove item" loading><svg aria-hidden="true" /></IconButton>
      {(["default", "secondary", "outline", "ghost", "destructive", "link"] as const).map((variant) => (
        <Button key={variant} variant={variant} loading>{variant}</Button>
      ))}
    </>));
    expect(getByRole(container, "button", { name: "Remove item" }).getAttribute("aria-busy")).toBe("true");
    for (const button of container.querySelectorAll("button")) {
      expect(button.disabled).toBe(true);
      expect(button.querySelectorAll('[data-slot="button-spinner"]')).toHaveLength(1);
    }
  });
});
