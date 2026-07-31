import userEvent from "@testing-library/user-event";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "@/lib/api";
import { UniversityPicker } from "./university-picker";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
let sessionStatus: "authenticated" | "unauthenticated" = "unauthenticated";

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public readonly status: number,
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
  api: { get: vi.fn(), post: vi.fn() },
}));
vi.mock("@/lib/i18n", () => ({ useLocale: () => ({ t: (key: string) => key }) }));
vi.mock("@/lib/session", () => ({ useSessionContext: () => ({ status: sessionStatus }) }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));
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
  }) => <input value={value} onChange={(event) => onValueChange(event.target.value)} />,
  CommandItem: ({
    children,
    disabled,
    onSelect,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onSelect: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onSelect}>
      {children}
    </button>
  ),
  CommandList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("radix-ui", () => ({
  Popover: {
    Root: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Trigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Portal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mockGet = api.get as ReturnType<typeof vi.fn>;
const mockPost = api.post as ReturnType<typeof vi.fn>;

describe("UniversityPicker proposals", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStatus = "unauthenticated";
    mockGet.mockReset().mockResolvedValue({ universities: [] });
    mockPost.mockReset();
    toastError.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  async function openAndSearch(query: string) {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await act(async () => root.render(<UniversityPicker value="" onChange={vi.fn()} />));
    await user.type(container.querySelector("input") as HTMLInputElement, query);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    return user;
  }

  it("does not offer an anonymous caller the authenticated proposal mutation", async () => {
    await openAndSearch("New University");

    expect(document.body.textContent).not.toContain("addQuotedInline");
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("uses the credentialed API client and treats a lost session as a sign-in problem", async () => {
    sessionStatus = "authenticated";
    const user = await openAndSearch("New University");
    mockPost.mockRejectedValue(new ApiError(401, "unauthorized", "Unauthorized"));

    await user.click(
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("addQuotedInline"),
      ) as HTMLButtonElement,
    );

    expect(mockPost).toHaveBeenCalledWith("/api/public/universities/propose", {
      name: "New University",
    });
    expect(toastError).toHaveBeenCalledWith("signIn");
  });
});
