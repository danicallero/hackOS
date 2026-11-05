import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  readServerState,
  resetServerStateForTests,
  setServerStateIdentity,
} from "@/lib/server-state";
import { useServerResource } from "./use-server-resource";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("useServerResource stale-while-revalidate", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: ReturnType<typeof useServerResource<string[]>>;
  const KEY = ["swr", "list"];

  function Probe({ fetcher }: { fetcher: () => Promise<string[]> }) {
    latest = useServerResource(KEY, fetcher);
    return null;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    resetServerStateForTests();
    setServerStateIdentity(1);
    container = document.createElement("div");
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("paints settled data without a loading state and revalidates once it is stale", async () => {
    await readServerState(KEY, async () => ["cached"]);
    vi.setSystemTime(Date.now() + 60_000);

    let resolve!: (v: string[]) => void;
    const fetcher = vi.fn(() => new Promise<string[]>((r) => (resolve = r)));
    await act(async () => root.render(<Probe fetcher={fetcher} />));

    expect(latest.loading).toBe(false);
    expect(latest.data).toEqual(["cached"]);
    expect(fetcher).toHaveBeenCalledOnce();

    await act(async () => resolve(["fresh"]));
    expect(latest.data).toEqual(["fresh"]);
    expect(latest.loading).toBe(false);
  });

  it("keeps the painted data when background revalidation fails", async () => {
    await readServerState(KEY, async () => ["cached"]);
    vi.setSystemTime(Date.now() + 60_000);
    await act(async () =>
      root.render(<Probe fetcher={() => Promise.reject(new Error("offline"))} />),
    );
    expect(latest.data).toEqual(["cached"]);
    expect(latest.error).toBeNull();
  });

  it("still reports loading and surfaces the failure on a cold mount", async () => {
    const fetcher = vi.fn(() => Promise.reject(new Error("offline")));
    await act(async () => root.render(<Probe fetcher={fetcher} />));
    expect(latest.data).toBeNull();
    expect(latest.error).toBeInstanceOf(Error);
  });
});
