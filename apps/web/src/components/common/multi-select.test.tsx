import userEvent from "@testing-library/user-event";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MultiSelect } from "./multi-select";

vi.mock("radix-ui", () => ({
  Popover: {
    Root: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Anchor: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Trigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  },
}));

vi.mock("@/components/common/icon-button", () => ({
  IconButton: ({
    label,
    children,
    ...props
  }: React.ComponentProps<"button"> & { label: string }) => (
    <button type="button" aria-label={label} {...props}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span data-slot="badge">{children}</span>,
}));
vi.mock("@/components/ui/button", () => ({ buttonVariants: () => "" }));
vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandInput: () => <input />,
  CommandItem: ({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
  CommandList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/hooks/use-dialog-portal", () => ({
  useDialogPortal: () => ({ ref: vi.fn(), portalProps: {}, contentProps: {} }),
}));
vi.mock("@/lib/i18n", () => ({
  useLocale: () => ({
    t: (key: string, values: Record<string, string | number> = {}) =>
      key === "removeItemLabel" ? `Remove ${values.name}` : key,
  }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const roleOptions = [
  { value: "judge", label: "Judge" },
  { value: "mentor", label: "Mentor" },
];

describe("MultiSelect", () => {
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

  it("keeps the menu open while selecting more than one option", async () => {
    const onChange = vi.fn();
    function RolePicker() {
      const [value, setValue] = useState<string[]>([]);
      return (
        <MultiSelect
          options={roleOptions}
          value={value}
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
          placeholder="Select roles"
        />
      );
    }

    await act(async () => root.render(<RolePicker />));
    const user = userEvent.setup();
    await user.click(
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Select roles"),
      ) as HTMLButtonElement,
    );
    await user.click(
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Judge"),
      ) as HTMLButtonElement,
    );
    await user.click(
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Mentor"),
      ) as HTMLButtonElement,
    );

    expect(onChange).toHaveBeenNthCalledWith(1, ["judge"]);
    expect(onChange).toHaveBeenNthCalledWith(2, ["judge", "mentor"]);
    expect(
      [...container.querySelectorAll('[data-slot="badge"]')].map((badge) => badge.textContent),
    ).toEqual(["Judge", "Mentor"]);
  });
});
