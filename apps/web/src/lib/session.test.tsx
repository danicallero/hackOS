import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  ApiError: class ApiError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  api: { get: vi.fn() },
}));

import { api } from "./api";
import { SessionProvider, useSessionContext } from "./session";
import type { Me } from "./types";

const profile = {
  id: 7,
  accountState: "removal_pending",
  removal: {
    status: "pending_exit",
    action: "anonymize",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    canCancel: true,
  },
} as unknown as Me;

function Probe() {
  const { me, status, error, refresh } = useSessionContext();
  return (
    <>
      <span data-testid="status">{status}</span>
      <span data-testid="owner">{me?.id ?? "none"}</span>
      <span data-testid="error">{error?.message ?? "none"}</span>
      <button type="button" onClick={() => void refresh()}>
        refresh
      </button>
    </>
  );
}

describe("web session refresh", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.mocked(api.get).mockReset().mockResolvedValue(profile);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps a pending-removal session mounted when profile refresh is transiently unavailable", async () => {
    await act(async () => {
      root.render(
        <SessionProvider>
          <Probe />
        </SessionProvider>,
      );
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe("authenticated");
    expect(container.querySelector('[data-testid="owner"]')?.textContent).toBe("7");

    vi.mocked(api.get).mockRejectedValueOnce(new Error("temporary outage"));
    await act(async () => {
      (container.querySelector("button") as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe("authenticated");
    expect(container.querySelector('[data-testid="owner"]')?.textContent).toBe("7");
    expect(container.querySelector('[data-testid="error"]')?.textContent).toBe("temporary outage");
  });
});
