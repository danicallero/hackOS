import { getByRole, queryByRole, waitFor } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Command, CommandInput, CommandItem, CommandList } from "./command";
import { Modal } from "../common/modal";
import { SidePanelEditor } from "../common/side-panel-editor";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  HTMLElement.prototype.scrollIntoView ??= () => {};
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

// H13/H21: most editors are controlled by an external row/action, not a Radix Trigger.
for (const Editor of [Modal, SidePanelEditor]) {
  it(`${Editor.name} traps keyboard focus and restores its external opener on Escape`, async () => {
    function Example() {
      const [open, setOpen] = useState(false);
      return <>
        <button type="button" onClick={() => setOpen(true)}>Edit record</button>
        <button type="button">Background</button>
        <Editor open={open} onOpenChange={setOpen} title="Editor" description="Edit details">
          <input aria-label="Details" />
          <button type="button">Save</button>
        </Editor>
      </>;
    }
    await act(async () => root.render(<Example />));
    const user = userEvent.setup();
    const opener = getByRole(host, "button", { name: "Edit record" });
    await act(async () => user.click(opener));
    const dialog = getByRole(document.body, "dialog", { name: "Editor" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    // Shift+Tab at the start wraps to the end; Tab wraps back to the input.
    getByRole(dialog, "textbox", { name: "Details" }).focus();
    await act(async () => user.tab({ shift: true }));
    expect(document.activeElement).toBe(getByRole(dialog, "button", { name: "close" }));
    await act(async () => user.tab());
    expect(document.activeElement).toBe(getByRole(dialog, "textbox", { name: "Details" }));
    await act(async () => user.keyboard("{Escape}"));
    await waitFor(() => expect(queryByRole(document.body, "dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
}

it("names the command search and retains its keyboard option navigation", async () => {
  await act(async () => root.render(<Command><CommandInput placeholder="Filter" /><CommandList><CommandItem>Alpha</CommandItem><CommandItem>Beta</CommandItem></CommandList></Command>));
  const input = getByRole(host, "combobox", { name: "genericSearchPlaceholder" });
  const user = userEvent.setup();
  await act(async () => user.click(input));
  await act(async () => user.keyboard("{ArrowDown}"));
  expect(input.getAttribute("aria-activedescendant")).toBe(getByRole(host, "option", { name: "Beta" }).id);
});

it("tabs use arrow keys, skip disabled items and link their panels", async () => {
  await act(async () => root.render(<Tabs defaultValue="one"><TabsList aria-label="Views"><TabsTrigger value="one">One</TabsTrigger><TabsTrigger disabled value="two">Two</TabsTrigger><TabsTrigger value="three">Three</TabsTrigger></TabsList><TabsContent value="one">First</TabsContent><TabsContent value="three">Third</TabsContent></Tabs>));
  const user = userEvent.setup();
  await act(async () => user.tab());
  expect(document.activeElement).toBe(getByRole(host, "tab", { name: "One" }));
  await act(async () => user.keyboard("{ArrowRight}"));
  const third = getByRole(host, "tab", { name: "Three" });
  expect(document.activeElement).toBe(third);
  expect(third.getAttribute("aria-selected")).toBe("true");
  expect(getByRole(host, "tabpanel", { name: "Three" }).id).toBe(third.getAttribute("aria-controls"));
});

it("restores the parent dialog after a nested dialog closes", async () => {
  function Example() {
    const [parent, setParent] = useState(false);
    const [child, setChild] = useState(false);
    return <><button type="button" onClick={() => setParent(true)}>Parent opener</button><Modal title="Parent" description="Parent form" open={parent} onOpenChange={setParent}><button type="button" onClick={() => setChild(true)}>Child opener</button><Modal title="Child" description="Child form" open={child} onOpenChange={setChild}><input aria-label="Child input" /></Modal></Modal></>;
  }
  await act(async () => root.render(<Example />));
  const user = userEvent.setup();
  const parentOpener = getByRole(host, "button", { name: "Parent opener" });
  await act(async () => user.click(parentOpener));
  const childOpener = getByRole(document.body, "button", { name: "Child opener" });
  await act(async () => user.click(childOpener));
  await act(async () => user.keyboard("{Escape}"));
  await waitFor(() => expect(document.activeElement).toBe(childOpener));
  expect(getByRole(document.body, "dialog", { name: "Parent" })).toBeTruthy();
  await act(async () => user.keyboard("{Escape}"));
  await waitFor(() => expect(document.activeElement).toBe(parentOpener));
});

it("respects a caller's explicit focus destination", async () => {
  function Example() {
    const [open, setOpen] = useState(false);
    return <><button type="button" onClick={() => setOpen(true)}>Opener</button><button type="button" id="destination">Destination</button><Modal title="Editor" description="Form" open={open} onOpenChange={setOpen} onCloseAutoFocus={(event) => { event.preventDefault(); document.getElementById("destination")?.focus(); }}><input aria-label="Field" /></Modal></>;
  }
  await act(async () => root.render(<Example />));
  const user = userEvent.setup();
  await act(async () => user.click(getByRole(host, "button", { name: "Opener" })));
  await act(async () => user.keyboard("{Escape}"));
  await waitFor(() => expect(document.activeElement).toBe(getByRole(host, "button", { name: "Destination" })));
});

it("uses a surviving adjacent action when the opener is removed", async () => {
  function Example() {
    const [open, setOpen] = useState(false);
    const [removed, setRemoved] = useState(false);
    return <><div>{!removed && <button type="button" onClick={() => setOpen(true)}>Remove record</button>}<button type="button">Next record</button></div><Modal title="Remove" description="Confirm removal" open={open} onOpenChange={setOpen}><button type="button" onClick={() => { setRemoved(true); setOpen(false); }}>Confirm removal</button></Modal></>;
  }
  await act(async () => root.render(<Example />));
  const user = userEvent.setup();
  await act(async () => user.click(getByRole(host, "button", { name: "Remove record" })));
  await act(async () => user.click(getByRole(document.body, "button", { name: "Confirm removal" })));
  await waitFor(() => expect(document.activeElement).toBe(getByRole(host, "button", { name: "Next record" })));
});

it("returns to the menu button when the opening menu item unmounts", async () => {
  const { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } = await import("./dropdown-menu");
  function Example() {
    const [open, setOpen] = useState(false);
    return <><DropdownMenu><DropdownMenuTrigger>Actions</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem onSelect={() => setOpen(true)}>Edit record</DropdownMenuItem></DropdownMenuContent></DropdownMenu><Modal title="Editor" description="Form" open={open} onOpenChange={setOpen}><input aria-label="Field" /></Modal></>;
  }
  await act(async () => root.render(<Example />));
  const user = userEvent.setup();
  const trigger = getByRole(host, "button", { name: "Actions" });
  trigger.focus();
  await act(async () => user.keyboard("{ArrowDown}{Enter}"));
  await waitFor(() => expect(getByRole(document.body, "dialog", { name: "Editor" }).contains(document.activeElement)).toBe(true));
  await act(async () => user.keyboard("{Escape}"));
  await waitFor(() => expect(document.activeElement).toBe(trigger));
});
