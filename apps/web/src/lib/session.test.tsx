import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../hooks/use-event-source", () => ({ useEventSource: vi.fn() }));

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

import { domainScope, EVENTS, SSE_TOPICS } from "@hackos/shared/events";
import { useEventSource } from "../hooks/use-event-source";
import { ApiError, api } from "./api";
import { SessionProvider, useSessionContext } from "./session";
import { notifySignOut } from "./sign-out-events";
import type { Me } from "./types";
import { getViewedEdition, resetViewedEdition, setViewedEdition } from "./viewed-edition";

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

  it("coalesces concurrent refreshes into one profile request", async () => {
    let resolveRequest!: (value: Me) => void;
    vi.mocked(api.get).mockReturnValueOnce(
      new Promise<Me>((resolve) => {
        resolveRequest = resolve;
      }),
    );

    await act(async () => {
      root.render(
        <SessionProvider>
          <Probe />
        </SessionProvider>,
      );
      await Promise.resolve();
    });

    await act(async () => {
      (container.querySelector("button") as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(api.get).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRequest(profile);
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe("authenticated");
  });

  it("does not restore account A when sign-out wins a delayed profile request", async () => {
    let resolveRequest!: (value: Me) => void;
    vi.mocked(api.get).mockReturnValueOnce(
      new Promise<Me>((resolve) => {
        resolveRequest = resolve;
      }),
    );

    await act(async () => {
      root.render(
        <SessionProvider>
          <Probe />
        </SessionProvider>,
      );
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe("loading");

    act(() => notifySignOut());
    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe("unauthenticated");
    expect(container.querySelector('[data-testid="owner"]')?.textContent).toBe("none");

    await act(async () => {
      resolveRequest(profile);
      await Promise.resolve();
    });
    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe("unauthenticated");
    expect(container.querySelector('[data-testid="owner"]')?.textContent).toBe("none");
  });

  it.each([
    403, 404,
  ])("drops a remembered edition that answers %i and retries /api/me once", async (status) => {
    setViewedEdition("old-edition");
    vi.mocked(api.get)
      .mockReset()
      .mockRejectedValueOnce(
        new (ApiError as unknown as new (status: number, message: string) => Error)(status, "gone"),
      )
      .mockResolvedValueOnce(profile);

    await act(async () => {
      root.render(
        <SessionProvider>
          <Probe />
        </SessionProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.get).toHaveBeenCalledTimes(2);
    expect(getViewedEdition()).toBeNull();
    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe("authenticated");
  });

  it("does not retry a 403 when no edition is remembered", async () => {
    resetViewedEdition();
    vi.mocked(api.get)
      .mockReset()
      .mockRejectedValue(
        new (ApiError as unknown as new (status: number, message: string) => Error)(
          403,
          "forbidden",
        ),
      );

    await act(async () => {
      root.render(
        <SessionProvider>
          <Probe />
        </SessionProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.get).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe("unauthenticated");
  });

  it("refreshes /api/me when an edition changes", async () => {
    await act(async () => {
      root.render(
        <SessionProvider>
          <Probe />
        </SessionProvider>,
      );
      await Promise.resolve();
    });
    const call = vi
      .mocked(useEventSource)
      .mock.calls.filter(([scope]) => scope === domainScope(SSE_TOPICS.IDENTITY))
      .at(-1);
    expect(call?.[1]?.events).toEqual([EVENTS.EDITION_CHANGED]);
    expect(call?.[1]?.enabled).toBe(true);

    vi.useFakeTimers();
    vi.mocked(api.get).mockClear();
    act(() => call?.[1]?.onEvent?.({} as never));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    vi.useRealTimers();
    expect(api.get).toHaveBeenCalledWith("/api/me");
  });
});
