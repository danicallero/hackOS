import userEvent from "@testing-library/user-event";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type UserOption, UserPicker, userOptionLabel } from "./user-picker";

vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));

vi.mock("@/components/ui/button", async () => {
  const React = await import("react");
  return {
    Button: React.forwardRef<HTMLButtonElement, React.ComponentProps<"button">>(
      ({ children, ...props }, ref) => (
        <button ref={ref} {...props}>
          {children}
        </button>
      ),
    ),
  };
});

vi.mock("@/components/ui/command", () => ({
  Command: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandEmpty: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  CommandGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CommandInput: ({
    onValueChange,
    value,
  }: {
    onValueChange: (value: string) => void;
    value: string;
  }) => (
    <input
      aria-label="Search users"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    />
  ),
  CommandItem: ({ children, onSelect }: { children: React.ReactNode; onSelect: () => void }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
  CommandList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("radix-ui", async () => {
  const React = await import("react");
  const Context = React.createContext<{
    open: boolean;
    onOpenChange: (open: boolean) => void;
  } | null>(null);

  return {
    Popover: {
      Root: ({
        open,
        onOpenChange,
        children,
      }: {
        open: boolean;
        onOpenChange: (open: boolean) => void;
        children: React.ReactNode;
      }) => <Context.Provider value={{ open, onOpenChange }}>{children}</Context.Provider>,
      Trigger: ({ children }: { children: React.ReactNode }) => {
        const context = React.useContext(Context);
        if (
          !React.isValidElement<{ onClick?: React.MouseEventHandler<HTMLButtonElement> }>(children)
        ) {
          return null;
        }
        return React.cloneElement(children, {
          onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
            children.props.onClick?.(event);
            context?.onOpenChange(!context.open);
          },
        });
      },
      Content: ({ children }: { children: React.ReactNode }) => {
        const context = React.useContext(Context);
        return context?.open ? <div>{children}</div> : null;
      },
      Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    },
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function deferred<T>() {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve: (value: T) => resolve(value) };
}

function PickerHarness({
  search,
  autoSelect,
  onChange,
}: {
  search: (query: string) => Promise<UserOption[]>;
  autoSelect: (users: UserOption[]) => UserOption | null;
  onChange: (value: string, user: UserOption | null) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <UserPicker
      value={value}
      onChange={(nextValue, user) => {
        setValue(nextValue);
        onChange(nextValue, user);
      }}
      search={search}
      initialQuery="María López"
      autoSelect={autoSelect}
    />
  );
}

describe("UserPicker contextual suggestions", () => {
  let root: Root;
  let container: HTMLDivElement;

  const maria = { id: 1, name: "Maria", surname: "Lopez", email: "maria@example.test" };
  const other = { id: 2, name: "Other", surname: "Person", email: "other@example.test" };

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("loads the profile query on open and preselects an explicitly safe candidate", async () => {
    const search = vi.fn().mockResolvedValue([maria]);
    const onChange = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await act(async () =>
      root.render(<PickerHarness search={search} autoSelect={() => maria} onChange={onChange} />),
    );

    await user.click(container.querySelector('[role="combobox"]') as HTMLButtonElement);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(search).toHaveBeenCalledWith("María López");
    expect(onChange).toHaveBeenCalledWith("1", maria);
    expect(container.textContent).toContain(userOptionLabel(maria));
  });

  it("keeps a manual selection when an older suggestion request resolves late", async () => {
    const initial = deferred<UserOption[]>();
    const search = vi.fn((query: string) => {
      if (query === "María López") return initial.promise;
      return Promise.resolve([other]);
    });
    const onChange = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await act(async () =>
      root.render(<PickerHarness search={search} autoSelect={() => maria} onChange={onChange} />),
    );

    await user.click(container.querySelector('[role="combobox"]') as HTMLButtonElement);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await user.clear(
      document.querySelector('input[aria-label="Search users"]') as HTMLInputElement,
    );
    await user.type(
      document.querySelector('input[aria-label="Search users"]') as HTMLInputElement,
      "Other",
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await user.click(
      [...document.querySelectorAll("button")].find(
        (button) => button.textContent === userOptionLabel(other),
      ) as HTMLButtonElement,
    );

    await act(async () => {
      initial.resolve([maria]);
      await Promise.resolve();
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("2", other);
    expect(container.querySelector('[role="combobox"]')?.textContent).toContain(
      userOptionLabel(other),
    );
  });
});
