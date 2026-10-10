import userEvent from "@testing-library/user-event";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type UserOption, UserPicker, userOptionLabel } from "@/components/common/user-picker";
import { IdentityAccountPicker } from "./identity-account-picker";

vi.mock("@/lib/api", () => ({ api: { get: vi.fn() } }));
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

const person = { name: "María", surname: "López", email: "maria@devpost.test" };
const maria = { id: 1, name: "Maria", surname: "Lopez", email: "ml@platform.test" };
const other = { id: 2, name: "Other", surname: "Person", email: "other@platform.test" };

function Harness({
  fetchUsers,
  onChange,
}: {
  fetchUsers: (query: string, limit: number) => Promise<UserOption[]>;
  onChange: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <IdentityAccountPicker
      person={person}
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      fetchUsers={fetchUsers}
    />
  );
}

describe("IdentityAccountPicker suggestions (H17)", () => {
  let root: Root;
  let container: HTMLDivElement;

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

  const trigger = () => container.querySelector('[role="combobox"]') as HTMLButtonElement;
  const input = () =>
    document.querySelector('input[aria-label="Search users"]') as HTMLInputElement;
  const settle = () =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

  async function open(fetchUsers: (q: string, limit: number) => Promise<UserOption[]>) {
    const onChange = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await act(async () => root.render(<Harness fetchUsers={fetchUsers} onChange={onChange} />));
    await user.click(trigger());
    return { onChange, user };
  }

  it("preselects the single top-ranked suggestion when the picker opens", async () => {
    const fetchUsers = vi.fn().mockResolvedValue([maria]);
    const { onChange } = await open(fetchUsers);
    await settle();

    expect(fetchUsers).toHaveBeenCalledWith("María López", 50);
    expect(onChange).toHaveBeenCalledWith("1");
    expect(trigger().textContent).toContain(userOptionLabel(maria));
  });

  it("does not preselect when a suggestion request hit its limit", async () => {
    const filler = Array.from({ length: 49 }, (_, i) => ({ ...other, id: 100 + i }));
    const { onChange } = await open(vi.fn().mockResolvedValue([maria, ...filler]));
    await settle();

    expect(onChange).not.toHaveBeenCalled();
  });

  it("never preselects once the operator has typed, even if they clear the query", async () => {
    const initial = deferred<UserOption[]>();
    const fetchUsers = vi.fn((q: string) =>
      q === "María López" ? initial.promise : Promise.resolve([maria]),
    );
    const { onChange, user } = await open(fetchUsers);
    await user.type(input(), "Ma");
    await settle();
    await act(async () => initial.resolve([maria]));
    await user.clear(input());
    await settle();

    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps a manual selection when the suggestion request resolves late", async () => {
    const initial = deferred<UserOption[]>();
    const fetchUsers = vi.fn((q: string) =>
      q === "María López" ? initial.promise : Promise.resolve([other]),
    );
    const { onChange, user } = await open(fetchUsers);
    await settle();
    await user.type(input(), "Other");
    await settle();
    await user.click(
      [...document.querySelectorAll("button")].find(
        (button) => button.textContent === userOptionLabel(other),
      ) as HTMLButtonElement,
    );
    await act(async () => initial.resolve([maria]));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith("2");
  });
});

describe("UserPicker", () => {
  it("keeps the typed query across reopen and reports only current results", async () => {
    vi.useFakeTimers();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onResults = vi.fn();
    const search = vi.fn().mockResolvedValue([other]);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await act(async () =>
      root.render(
        <UserPicker value="" onChange={() => {}} search={search} onResults={onResults} />,
      ),
    );
    const trigger = container.querySelector('[role="combobox"]') as HTMLButtonElement;
    await user.click(trigger);
    await user.type(
      document.querySelector('input[aria-label="Search users"]') as HTMLInputElement,
      "Ot",
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    await user.click(trigger);
    await user.click(trigger);

    expect(
      (document.querySelector('input[aria-label="Search users"]') as HTMLInputElement).value,
    ).toBe("Ot");
    expect(onResults).toHaveBeenCalledWith("Ot", [other]);
    expect(onResults).not.toHaveBeenCalledWith("O", expect.anything());
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });
});
